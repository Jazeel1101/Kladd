import type {
  ScreenCaptureFailed,
  ScreenCapturePermission,
  ScreenCapturePermissionDenied,
} from "@kladd/domain";
import { Context, type Effect, type Scope } from "effect";

/**
 * Port: screen capture permission, screenshots and screen video. Implemented per OS in
 * packages/platform-<os>. Captures leave out Kladd's own windows. To ask for permission only when
 * it is missing, use requireScreenCapture (../capture/requireScreenCapture.ts).
 * Test double: ScreenCaptureTest in ../testing.
 */
export class ScreenCapture extends Context.Service<
  ScreenCapture,
  {
    /** The current permission. Never prompts. */
    readonly permission: Effect.Effect<ScreenCapturePermission, ScreenCaptureFailed>;
    /** Guides the user to grant permission (System Settings), then reports the result. */
    readonly requestPermission: Effect.Effect<ScreenCapturePermission, ScreenCaptureFailed>;
    /** Saves the main display as a PNG at `file`. */
    readonly screenshot: (
      file: string,
    ) => Effect.Effect<void, ScreenCapturePermissionDenied | ScreenCaptureFailed>;
    /**
     * Records the main display to a video at `file` until the scope closes, then finishes the file.
     * Succeeds once recording has started.
     */
    readonly recordVideo: (
      file: string,
    ) => Effect.Effect<void, ScreenCapturePermissionDenied | ScreenCaptureFailed, Scope.Scope>;
  }
>()("kladd/core/ScreenCapture") {}
