import {
  adapterFor,
  emptyFocus,
  placeInside,
  placeOverlay,
  placeWithoutAnchor,
  type AppAdapter,
  type FocusSnapshot,
  type LoggingOverlayInfo,
  type WritingTarget,
} from "@kladd/domain";
import { Context, Effect, FiberHandle, Layer, Semaphore, Stream, SubscriptionRef } from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { FocusTracker } from "../ports/FocusTracker";
import { OverlayWindows } from "../ports/OverlayWindows";

const sameTarget = (a: WritingTarget, b: WritingTarget) =>
  a.app === b.app && a.document === b.document;

/**
 * Use case: show the logging overlay next to where the user writes, and tell its UI what they are
 * writing in. While it is open, it follows that app, so the writing target changes with the page.
 * How placement works: docs/internals/overlay-placement.md.
 */
export class LoggingOverlay extends Context.Service<
  LoggingOverlay,
  {
    /** Places and shows the overlay for the current focus. Never fails: it falls back to the no-anchor position. */
    readonly open: Effect.Effect<void>;
    /** Hides the overlay and stops following the app it was opened for. */
    readonly close: Effect.Effect<void>;
    /** What the overlay was last opened for (null before the first open), then every change. */
    readonly changes: Stream.Stream<LoggingOverlayInfo | null>;
  }
>()("kladd/core/LoggingOverlay") {
  static readonly layer = Layer.effect(
    LoggingOverlay,
    Effect.gen(function* () {
      const focus = yield* FocusTracker;
      const windows = yield* OverlayWindows;
      const adapters = yield* AppAdapters;
      const info = yield* SubscriptionRef.make<LoggingOverlayInfo | null>(null);
      // The one watch of the app the overlay was opened for. Lives as long as the layer.
      const following = yield* FiberHandle.make<void, never>();
      // One open or close at a time, so a slow earlier open can't move the overlay after a newer one.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

      // Moves only the writing target: the overlay stays where it was placed.
      const follow = (adapter: AppAdapter, opened: FocusSnapshot) =>
        focus.watch.pipe(
          Stream.filter((snapshot) => snapshot.app?.bundleId === opened.app?.bundleId),
          Stream.map(adapter.target),
          // Every set reaches the UI, so set only a target that changed. Only open writes `info`
          // otherwise, and it stops this fiber first.
          Stream.runForEach((target) =>
            SubscriptionRef.get(info).pipe(
              Effect.flatMap((current) =>
                current === null || sameTarget(current.target, target)
                  ? Effect.void
                  : SubscriptionRef.set(info, { ...current, target }),
              ),
            ),
          ),
          Effect.catchTag("FocusTrackingFailed", (error) =>
            Effect.logWarning("Stopped following focus", error.reason),
          ),
          Effect.withSpan("LoggingOverlay.follow"),
        );

      const open = Effect.gen(function* () {
        // Before setting info: a watch of the previous app must not overwrite this open's target.
        yield* FiberHandle.clear(following);
        const snapshot = yield* focus.current.pipe(
          Effect.catchTag("FocusTrackingFailed", (error) =>
            Effect.logWarning("Could not read focus", error.reason).pipe(Effect.as(emptyFocus)),
          ),
        );
        const adapter = adapterFor(adapters.all, adapters.fallback, snapshot);
        const anchor = adapter.anchor(snapshot);
        const size = windows.size("logging");
        const screen = yield* windows.workArea(anchor ?? snapshot.window);
        const bounds =
          anchor === null
            ? placeWithoutAnchor(size, screen)
            : adapter.placement === "inside"
              ? placeInside(anchor, size, screen)
              : placeOverlay(anchor, size, screen);
        yield* Effect.annotateCurrentSpan({ adapter: adapter.id, anchored: anchor !== null });
        // Set before showing: a window opened for the first time reads it when its UI subscribes.
        yield* SubscriptionRef.set(info, {
          target: adapter.target(snapshot),
          adapter: adapter.id,
          anchored: anchor !== null,
        });
        yield* windows.show("logging", bounds);
        if (snapshot.app !== null) yield* FiberHandle.run(following, follow(adapter, snapshot));
      }).pipe(oneAtATime, Effect.withSpan("LoggingOverlay.open"));

      const close = FiberHandle.clear(following).pipe(
        Effect.andThen(windows.hide("logging")),
        oneAtATime,
        Effect.withSpan("LoggingOverlay.close"),
      );

      return LoggingOverlay.of({ open, close, changes: SubscriptionRef.changes(info) });
    }),
  );
}
