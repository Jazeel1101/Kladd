import type { AccessibilityPermission, FocusSnapshot, FocusTrackingFailed } from "@kladd/domain";
import { Context, type Effect, type Stream } from "effect";

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
    /**
     * The app the user is in, as `current` reads it, then a new snapshot of that same app each time
     * it changes (another page, window or focused element). Ends when the app quits; runs until
     * interrupted otherwise.
     */
    readonly watch: Stream.Stream<FocusSnapshot, FocusTrackingFailed>;
    /** The current permission. Never prompts. */
    readonly permission: Effect.Effect<AccessibilityPermission, FocusTrackingFailed>;
    /** Guides the user to grant permission (System Settings), then reports the result. */
    readonly requestPermission: Effect.Effect<AccessibilityPermission, FocusTrackingFailed>;
    /**
     * Makes the app with `bundleId` the active app, as a click on its Dock icon does, which also
     * takes keyboard focus back from an overlay the user clicked into.
     */
    readonly activate: (bundleId: string) => Effect.Effect<void, FocusTrackingFailed>;
  }
>()("kladd/core/FocusTracker") {}
