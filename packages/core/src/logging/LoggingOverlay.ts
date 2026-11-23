import { adapterFor, placeOverlay, placeWithoutAnchor } from "@kladd/domain";
import { Context, Effect, Layer } from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { FocusTracker } from "../ports/FocusTracker";
import { OverlayWindows } from "../ports/OverlayWindows";

/**
 * Use case: show the logging overlay next to where the user writes.
 * How placement works: docs/internals/overlay-placement.md.
 */
export class LoggingOverlay extends Context.Service<
  LoggingOverlay,
  {
    readonly open: Effect.Effect<void>;
  }
>()("kladd/core/LoggingOverlay") {
  static readonly layer = Layer.effect(
    LoggingOverlay,
    Effect.gen(function* () {
      const focus = yield* FocusTracker;
      const windows = yield* OverlayWindows;
      const adapters = yield* AppAdapters;

      const open = Effect.gen(function* () {
        const snapshot = yield* focus.current;
        const adapter = adapterFor(adapters.all, adapters.fallback, snapshot);
        const anchor = adapter.anchor(snapshot);
        const size = windows.size("logging");
        const screen = yield* windows.workArea(anchor ?? snapshot.window);
        const bounds =
          anchor === null ? placeWithoutAnchor(size, screen) : placeOverlay(anchor, size, screen);
        yield* Effect.annotateCurrentSpan({ adapter: adapter.id, anchored: anchor !== null });
        yield* windows.show("logging", bounds);
      }).pipe(Effect.withSpan("LoggingOverlay.open"));

      return LoggingOverlay.of({ open });
    }),
  );
}
