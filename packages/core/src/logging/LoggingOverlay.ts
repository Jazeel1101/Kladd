import {
  adapterFor,
  closedLoggingOverlay,
  emptyFocus,
  placeBesidePill,
  placeWithoutPill,
  type AppAdapter,
  type FocusSnapshot,
  type LoggingOverlayState,
  type LoggingPanel,
  type PillDock,
  type WritingTarget,
} from "@kladd/domain";
import {
  Context,
  Effect,
  FiberHandle,
  Layer,
  Ref,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { FocusTracker } from "../ports/FocusTracker";
import { OverlayWindows } from "../ports/OverlayWindows";

const sameTarget = (a: WritingTarget, b: WritingTarget) =>
  a.app === b.app && a.document === b.document;

/**
 * Use case: grow the logging overlay out of the pill, and tell its UI what the user is writing in.
 * While it is open, it follows that app, so the writing target changes with the page, and it moves
 * with the pill. The pill's star opens and closes it; its gear swaps the summary for the
 * log's settings. How placement works: docs/internals/overlay-placement.md.
 */
export class LoggingOverlay extends Context.Service<
  LoggingOverlay,
  {
    /** Shows the overlay on its summary, grown out of the pill. Never fails. */
    readonly open: Effect.Effect<void>;
    /** Hides the overlay and stops following the app it was opened for. */
    readonly close: Effect.Effect<void>;
    /**
     * The pill's star: opens the overlay on its summary, switches it back to the summary from the
     * settings, or closes it.
     */
    readonly toggle: Effect.Effect<void>;
    /** The pill's gear: swaps the open overlay between summary and settings, or opens it on settings. */
    readonly toggleSettings: Effect.Effect<void>;
    /** The pill came to rest at `dock`, or started moving (null). An open overlay moves with it. */
    readonly pillAt: (dock: PillDock | null) => Effect.Effect<void>;
    /** The overlay now, then every change. */
    readonly changes: Stream.Stream<LoggingOverlayState>;
  }
>()("kladd/core/LoggingOverlay") {
  static readonly layer = Layer.effect(
    LoggingOverlay,
    Effect.gen(function* () {
      const focus = yield* FocusTracker;
      const windows = yield* OverlayWindows;
      const adapters = yield* AppAdapters;
      const state = yield* SubscriptionRef.make(closedLoggingOverlay);
      const dock = yield* Ref.make<PillDock | null>(null);
      // The one watch of the app the overlay was opened for. Lives as long as the layer.
      const following = yield* FiberHandle.make<void, never>();
      // One change at a time, so a slow earlier open can't move the overlay after a newer one.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

      // Moves only the writing target: following the app never moves the overlay.
      const follow = (adapter: AppAdapter, opened: FocusSnapshot) =>
        focus.watch.pipe(
          Stream.filter((snapshot) => snapshot.app?.bundleId === opened.app?.bundleId),
          Stream.map(adapter.target),
          // Every set reaches the UI, so set only a target that changed.
          Stream.runForEach((target) =>
            SubscriptionRef.update(state, (current) =>
              sameTarget(current.target, target) ? current : { ...current, target },
            ),
          ),
          Effect.catchTag("FocusTrackingFailed", (error) =>
            Effect.logWarning("Stopped following focus", error.reason),
          ),
          Effect.withSpan("LoggingOverlay.follow"),
        );

      /** Beside the pill where it rests; at the screen's edge, unjoined, before it has rested. */
      const place = Effect.gen(function* () {
        const size = windows.size("logging");
        const resting = yield* Ref.get(dock);
        if (resting === null) {
          return { bounds: placeWithoutPill(size, yield* windows.workArea(null)), join: null };
        }
        return placeBesidePill(resting, size, yield* windows.workArea(resting.notch));
      });

      const show = Effect.fn("LoggingOverlay.show")(function* (panel: LoggingPanel) {
        // Before setting the target: a watch of the previous app must not overwrite this one's.
        yield* FiberHandle.clear(following);
        const snapshot = yield* focus.current.pipe(
          Effect.catchTag("FocusTrackingFailed", (error) =>
            Effect.logWarning("Could not read focus", error.reason).pipe(Effect.as(emptyFocus)),
          ),
        );
        const adapter = adapterFor(adapters.all, adapters.fallback, snapshot);
        const { bounds, join } = yield* place;
        yield* Effect.annotateCurrentSpan({ adapter: adapter.id, joined: join !== null });
        // Closed while it is shown, then open: the UI draws the join at the new place first, then
        // grows the panel out of it.
        yield* SubscriptionRef.set(state, {
          open: false,
          panel,
          target: adapter.target(snapshot),
          join,
        });
        yield* windows.show("logging", bounds);
        yield* SubscriptionRef.update(state, (current) => ({ ...current, open: true }));
        if (snapshot.app !== null) yield* FiberHandle.run(following, follow(adapter, snapshot));
      });

      const hide = FiberHandle.clear(following).pipe(
        Effect.andThen(SubscriptionRef.update(state, (current) => ({ ...current, open: false }))),
        Effect.andThen(windows.hide("logging")),
      );

      const setPanel = (panel: LoggingPanel) =>
        SubscriptionRef.update(state, (current) => ({ ...current, panel }));

      const toggle = Effect.gen(function* () {
        const { open, panel } = yield* SubscriptionRef.get(state);
        if (!open) return yield* show("summary");
        yield* panel === "settings" ? setPanel("summary") : hide;
      });

      const toggleSettings = Effect.gen(function* () {
        const { open, panel } = yield* SubscriptionRef.get(state);
        if (!open) return yield* show("settings");
        yield* setPanel(panel === "settings" ? "summary" : "settings");
      });

      const pillAt = Effect.fn("LoggingOverlay.pillAt")(function* (next: PillDock | null) {
        yield* Ref.set(dock, next);
        if (!(yield* SubscriptionRef.get(state)).open) return;
        if (next === null) {
          // Drops the neck while the pill moves away from it; the overlay waits where it is.
          return yield* SubscriptionRef.update(state, (current) => ({ ...current, join: null }));
        }
        const { bounds, join } = yield* place;
        yield* windows.moveTo("logging", bounds);
        yield* SubscriptionRef.update(state, (current) => ({ ...current, join }));
      });

      return LoggingOverlay.of({
        open: show("summary").pipe(oneAtATime),
        close: hide.pipe(oneAtATime, Effect.withSpan("LoggingOverlay.close")),
        toggle: toggle.pipe(oneAtATime, Effect.withSpan("LoggingOverlay.toggle")),
        toggleSettings: toggleSettings.pipe(
          oneAtATime,
          Effect.withSpan("LoggingOverlay.toggleSettings"),
        ),
        pillAt: (next) => pillAt(next).pipe(oneAtATime),
        changes: SubscriptionRef.changes(state),
      });
    }),
  );
}
