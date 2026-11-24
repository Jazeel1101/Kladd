import {
  adapterFor,
  emptyFocus,
  placeOverlay,
  placeWithoutAnchor,
  type LoggingOverlayInfo,
} from "@kladd/domain";
import { Context, Effect, Layer, Semaphore, type Stream, SubscriptionRef } from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { FocusTracker } from "../ports/FocusTracker";
import { OverlayWindows } from "../ports/OverlayWindows";

/**
 * Use case: show the logging overlay next to where the user writes, and tell its UI what they are
 * writing in. How placement works: docs/internals/overlay-placement.md.
 */
export class LoggingOverlay extends Context.Service<
  LoggingOverlay,
  {
    /** Places and shows the overlay for the current focus. Never fails: it falls back to the no-anchor position. */
    readonly open: Effect.Effect<void>;
    /** What the overlay was last opened for (null before the first open), then every later open. */
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
      // One open at a time, so a slow earlier open can't move the overlay after a newer one.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

      const open = Effect.gen(function* () {
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
          anchor === null ? placeWithoutAnchor(size, screen) : placeOverlay(anchor, size, screen);
        yield* Effect.annotateCurrentSpan({ adapter: adapter.id, anchored: anchor !== null });
        // Set before showing: a window opened for the first time reads it when its UI subscribes.
        yield* SubscriptionRef.set(info, {
          target: adapter.target(snapshot),
          adapter: adapter.id,
          anchored: anchor !== null,
        });
        yield* windows.show("logging", bounds);
      }).pipe(oneAtATime, Effect.withSpan("LoggingOverlay.open"));

      return LoggingOverlay.of({ open, changes: SubscriptionRef.changes(info) });
    }),
  );
}
