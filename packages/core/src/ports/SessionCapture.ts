import type {
  CaptureMode,
  ScreenCaptureFailed,
  ScreenCapturePermissionDenied,
} from "@kladd/domain";
import { Context, type Effect, type Scope } from "effect";

/** A session folder being written by SessionCapture.start. */
export interface SessionCaptureHandle {
  /** Finishes every file in the folder; fails if it could not. */
  readonly stop: Effect.Effect<void, ScreenCaptureFailed>;
}

/**
 * Port: the capture of an active session (GLOSSARY: "økt"), which records its clips and takes its
 * screenshots. In auto mode it also writes the live files of the session folder (GLOSSARY:
 * "opptaksmappe"): timeline, keyframes with OCR, and focus; in manual mode it writes nothing itself.
 * Implemented per OS in packages/platform-<os>. Test double: SessionCaptureTest in ../testing.
 */
export class SessionCapture extends Context.Service<
  SessionCapture,
  {
    /**
     * Starts capturing into `dir`, which exists; succeeds once it is ready for clips and
     * screenshots. Closing the scope stops it too, but can't report a failure.
     */
    readonly start: (
      dir: string,
      mode: CaptureMode,
    ) => Effect.Effect<
      SessionCaptureHandle,
      ScreenCapturePermissionDenied | ScreenCaptureFailed,
      Scope.Scope
    >;
  }
>()("kladd/core/SessionCapture") {}
