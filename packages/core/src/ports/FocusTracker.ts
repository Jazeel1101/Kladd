import type { AccessibilityPermission, FocusSnapshot, FocusTrackingFailed } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: where the user is right now (front app, window, focused element, caret), and the
 * Accessibility permission reading it needs. Without it only the front app is known.
 * Implemented per OS in packages/platform-<os>. Test double: FocusTrackerTest in ../testing.
 */
export class FocusTracker extends Context.Service<
  FocusTracker,
  {
    /** Leaves out Kladd's own windows: if Kladd is in front, nothing is known. */
    readonly current: Effect.Effect<FocusSnapshot, FocusTrackingFailed>;
    /** The current permission. Never prompts. */
    readonly permission: Effect.Effect<AccessibilityPermission, FocusTrackingFailed>;
    /** Guides the user to grant permission (System Settings), then reports the result. */
    readonly requestPermission: Effect.Effect<AccessibilityPermission, FocusTrackingFailed>;
  }
>()("kladd/core/FocusTracker") {}
