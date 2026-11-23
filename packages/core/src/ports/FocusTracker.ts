import type { FocusSnapshot } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: where the user is right now (front app, window, focused element, caret).
 * Implemented per OS in packages/platform-<os>. Test double: FocusTrackerTest in ../testing.
 */
export class FocusTracker extends Context.Service<
  FocusTracker,
  {
    readonly current: Effect.Effect<FocusSnapshot>;
  }
>()("kladd/core/FocusTracker") {}
