import {
  type ScreenCaptureFailed,
  type ScreenCapturePermissionDenied,
  Screenshot,
  type ScreenshotSlot,
  type ScreenshotId,
  type ScreenshotTray,
  type SessionId,
  emptyScreenshotTray,
  landingIn,
  shareableFocus,
} from "@kladd/domain";
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Semaphore,
  type Stream,
  SubscriptionRef,
} from "effect";
import { requireScreenCapture } from "../capture/requireScreenCapture";
import { FocusTracker } from "../ports/FocusTracker";
import { Ids } from "../ports/Ids";
import { OverlayWindows } from "../ports/OverlayWindows";
import { ScreenCapture } from "../ports/ScreenCapture";
import { SessionStore } from "../ports/SessionStore";

/**
 * How long the flight window keeps its copy of a landed screenshot over the pill, so the pill has
 * drawn its own before the flight window goes.
 */
const handoff = Duration.millis(100);

/** Moves the screenshot in flight, if any, to the front of the tray. */
const landFlying = (tray: ScreenshotTray): ScreenshotTray =>
  tray.flying === null
    ? tray
    : { flying: null, attached: [tray.flying.screenshot, ...tray.attached] };

/** The active session, which screenshots are saved in. */
interface Target {
  readonly session: SessionId;
  readonly folder: string;
}

/**
 * Use case: ⌃⇧C or the pill screenshots the whole main display into the active session's folder,
 * with where the student was (FocusTracker), and flies it into the pill. The tray holds the session's
 * screenshots until its log is written. How the flight works: docs/internals/screenshot-flight.md.
 */
export class Screenshots extends Context.Service<
  Screenshots,
  {
    /**
     * Does nothing without an active session. Asks for screen capture permission first if Kladd
     * doesn't have it, then starts the screenshot's flight into the pill's slot. Before the pill has
     * said where its slot is, the screenshot is attached at once, without a flight. Leaves the
     * logging overlay alone.
     */
    readonly take: Effect.Effect<void, ScreenCapturePermissionDenied | ScreenCaptureFailed>;
    /**
     * The flight window calls this when the screenshot has reached the pill: attaches it and, once
     * the pill shows it, hides the flight window. Ignores any screenshot that is no longer the one
     * flying, so an old flight can't hide a newer one.
     */
    readonly land: (id: ScreenshotId) => Effect.Effect<void>;
    /** The pill reports where screenshots can land in it whenever it comes to rest. */
    readonly aimAt: (slot: ScreenshotSlot) => Effect.Effect<void>;
    /** The tray now, then on every change. */
    readonly changes: Stream.Stream<ScreenshotTray>;
    /** For Sessions: screenshots go into `folder`, and the tray shows the ones already there. */
    readonly begin: (session: SessionId, folder: string) => Effect.Effect<void>;
    /** For Sessions, as the session ends: takes no more. The tray keeps them for logging mode. */
    readonly end: Effect.Effect<void>;
    /** For Sessions, once the log is written: empties the tray. */
    readonly clear: Effect.Effect<void>;
  }
>()("kladd/core/Screenshots") {
  static readonly layer = Layer.effect(
    Screenshots,
    Effect.gen(function* () {
      const capture = yield* ScreenCapture;
      const store = yield* SessionStore;
      const focus = yield* FocusTracker;
      const ids = yield* Ids;
      const windows = yield* OverlayWindows;
      const tray = yield* SubscriptionRef.make(emptyScreenshotTray);
      const slot = yield* Ref.make<ScreenshotSlot | null>(null);
      const target = yield* Ref.make(Option.none<Target>());
      // One take at a time, so two quick presses fly one after the other, in order.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

      const take = Effect.gen(function* () {
        const into = yield* Ref.get(target);
        if (Option.isNone(into)) return;
        const { session, folder } = into.value;
        yield* requireScreenCapture.pipe(Effect.provideService(ScreenCapture, capture));
        const id = yield* ids.screenshotId;
        const takenAt = yield* DateTime.now;
        const file = yield* store.screenshotFile(folder, id);
        const [, at] = yield* Effect.all(
          [
            capture.screenshot(file),
            focus.current.pipe(
              Effect.map(shareableFocus),
              Effect.catchTag("FocusTrackingFailed", (error) =>
                Effect.logWarning("No focus for the screenshot", error.reason).pipe(
                  Effect.as(null),
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        const display = yield* windows.mainDisplay;
        const screenshot = new Screenshot({ id, session, takenAt, display });
        yield* store.saveScreenshot(folder, { id, session, takenAt, display, focus: at });
        const landing = yield* Ref.get(slot);
        // A screenshot still flying lands at once, so only one flies at a time.
        yield* SubscriptionRef.update(tray, (current) => {
          const landed = landFlying(current);
          return landing === null
            ? { flying: null, attached: [screenshot, ...landed.attached] }
            : { ...landed, flying: { screenshot, from: display, to: landingIn(landing, display) } };
        });
        if (landing !== null) yield* windows.show("flight", display);
      }).pipe(oneAtATime, Effect.withSpan("Screenshots.take"));

      const begin = Effect.fn("Screenshots.begin")(function* (session: SessionId, folder: string) {
        const saved = yield* store.screenshots(folder);
        const attached = saved
          .map(({ id, takenAt, display }) => new Screenshot({ id, session, takenAt, display }))
          .toReversed();
        yield* SubscriptionRef.set(tray, { flying: null, attached });
        yield* Ref.set(target, Option.some({ session, folder }));
      }, oneAtATime);

      const land = Effect.fn("Screenshots.land")(
        function* (id: ScreenshotId) {
          const current = yield* SubscriptionRef.get(tray);
          if (current.flying?.screenshot.id !== id) return;
          yield* SubscriptionRef.set(tray, landFlying(current));
          yield* Effect.sleep(handoff);
          yield* windows.hide("flight");
        },
        // Behind any take in progress, which may be about to fly a newer screenshot.
        oneAtATime,
      );

      return Screenshots.of({
        take,
        land,
        aimAt: (at) => Ref.set(slot, at),
        changes: SubscriptionRef.changes(tray),
        begin,
        // Behind a take in progress, so its screenshot is still saved in the session.
        end: Ref.set(target, Option.none()).pipe(oneAtATime),
        clear: SubscriptionRef.set(tray, emptyScreenshotTray).pipe(oneAtATime),
      });
    }),
  );
}
