import type { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import { Context, type Effect, type Scope } from "effect";

/** A session folder being written by SessionCapture.start. */
export interface SessionCaptureHandle {
  /** Finishes every file in the folder; fails if it could not. */
  readonly stop: Effect.Effect<void, ScreenCaptureFailed>;
}

/**
 * Port: writes the live files of a session folder (GLOSSARY: "opptaksmappe") while a recording
 * runs: timeline, keyframes with OCR, and focus. Implemented per OS in
 * packages/platform-<os>. Test double: SessionCaptureTest in ../testing.
 */
export class SessionCapture extends Context.Service<
  SessionCapture,
  {
    /**
     * Starts capturing into `dir`, which exists; succeeds once it is recording. Closing the scope
     * stops it too, but can't report a failure.
     */
    readonly start: (
      dir: string,
    ) => Effect.Effect<
      SessionCaptureHandle,
      ScreenCapturePermissionDenied | ScreenCaptureFailed,
      Scope.Scope
    >;
  }
>()("kladd/core/SessionCapture") {}
