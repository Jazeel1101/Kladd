import { FocusTracker } from "@kladd/core";
import { emptyFocus } from "@kladd/domain";
import { Effect, Layer } from "effect";

/**
 * macOS FocusTracker. STUB: reports nothing, so the logging overlay uses its no-anchor position.
 * Real version: the node-swift module described in docs/internals/overlay-placement.md.
 */
export const FocusTrackerDarwin = Layer.succeed(
  FocusTracker,
  FocusTracker.of({
    current: Effect.succeed(emptyFocus),
  }),
);
