import type {
  ScreenCaptureFailed,
  ScreenCapturePermission,
  ScreenCapturePermissionDenied,
} from "@kladd/domain";
import { Context, type Effect, type Scope } from "effect";

/** A screen video being recorded by ScreenCapture.recordVideo. */
export interface VideoRecording {
  readonly stop: Effect.Effect<void, ScreenCaptureFailed>;
}

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
     * Starts recording the main display to a video at `file`; succeeds once recording has started.
     * `stop` finishes the file and fails if it could not. Closing the scope stops it too, but can't
     * report a failure.
     */
    readonly recordVideo: (
      file: string,
    ) => Effect.Effect<
      VideoRecording,
      ScreenCapturePermissionDenied | ScreenCaptureFailed,
      Scope.Scope
    >;
  }
>()("kladd/core/ScreenCapture") {}
