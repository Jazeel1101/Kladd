import {
  type ScreenCaptureFailed,
  type ScreenCapturePermissionDenied,
  Screenshot,
  type Rect,
  type ScreenshotId,
  type ScreenshotTray,
  emptyScreenshotTray,
  landingIn,
} from "@kladd/domain";
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Ref,
  Semaphore,
  type Stream,
  SubscriptionRef,
} from "effect";
import { requireScreenCapture } from "../capture/requireScreenCapture";
import { Ids } from "../ports/Ids";
import { OverlayWindows } from "../ports/OverlayWindows";
import { ScreenCapture } from "../ports/ScreenCapture";
import { ScreenshotFiles } from "../ports/ScreenshotFiles";

/** Moves the screenshot in flight, if any, to the front of the tray. */
const landFlying = (tray: ScreenshotTray): ScreenshotTray =>
  tray.flying === null
    ? tray
    : { flying: null, attached: [tray.flying.screenshot, ...tray.attached] };

/**
 * Use case: ⌃⇧C screenshots the whole main display and flies it into the pill.
 * How the flight works: docs/internals/screenshot-flight.md.
 */
export class Screenshots extends Context.Service<
  Screenshots,
  {
    /**
     * Asks for screen capture permission first if Kladd doesn't have it, then starts the
     * screenshot's flight into the pill's notch. Before the pill has said where its notch is, the
     * screenshot is attached at once, without a flight. Leaves the logging overlay alone.
     */
    readonly take: Effect.Effect<Screenshot, ScreenCapturePermissionDenied | ScreenCaptureFailed>;
    /**
     * The flight window calls this when the screenshot has dropped into the pill: attaches it and
     * hides the flight window. Ignores any screenshot that is no longer the one flying, so an old
     * flight can't hide a newer one.
     */
    readonly land: (id: ScreenshotId) => Effect.Effect<void>;
    /** The pill reports where its notch is on screen whenever it comes to rest. */
    readonly aimAt: (notch: Rect) => Effect.Effect<void>;
    /** The tray now, then on every take and land. */
    readonly changes: Stream.Stream<ScreenshotTray>;
  }
>()("kladd/core/Screenshots") {
  static readonly layer = Layer.effect(
    Screenshots,
    Effect.gen(function* () {
      const capture = yield* ScreenCapture;
      const files = yield* ScreenshotFiles;
      const ids = yield* Ids;
      const windows = yield* OverlayWindows;
      const tray = yield* SubscriptionRef.make(emptyScreenshotTray);
      const notch = yield* Ref.make<Rect | null>(null);
      // One take at a time, so two quick presses fly one after the other, in order.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

      const take = Effect.gen(function* () {
        yield* requireScreenCapture.pipe(Effect.provideService(ScreenCapture, capture));
        const id = yield* ids.screenshotId;
        yield* capture.screenshot(yield* files.file(id));
        const display = yield* windows.mainDisplay;
        const screenshot = new Screenshot({ id, takenAt: yield* DateTime.now, display });
        const target = yield* Ref.get(notch);
        // A screenshot still flying lands at once, so only one flies at a time.
        yield* SubscriptionRef.update(tray, (current) => {
          const landed = landFlying(current);
          return target === null
            ? { flying: null, attached: [screenshot, ...landed.attached] }
            : { ...landed, flying: { screenshot, from: display, to: landingIn(target, display) } };
        });
        if (target !== null) yield* windows.show("flight", display);
        return screenshot;
      }).pipe(oneAtATime, Effect.withSpan("Screenshots.take"));

      const land = Effect.fn("Screenshots.land")(
        function* (id: ScreenshotId) {
          const current = yield* SubscriptionRef.get(tray);
          if (current.flying?.screenshot.id !== id) return;
          yield* SubscriptionRef.set(tray, landFlying(current));
          yield* windows.hide("flight");
        },
        // Behind any take in progress, which may be about to fly a newer screenshot.
        oneAtATime,
      );

      return Screenshots.of({
        take,
        land,
        aimAt: (at) => Ref.set(notch, at),
        changes: SubscriptionRef.changes(tray),
      });
    }),
  );
}
