import type { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import { Context, type Effect, type Scope } from "effect";

/** A clip being recorded by ClipCapture.start. */
export interface ClipCaptureHandle {
  /** Finishes the clip's files; fails if it could not. */
  readonly stop: Effect.Effect<void, ScreenCaptureFailed>;
}

/**
 * Port: records one clip (GLOSSARY: "klipp") into its folder: the whole main display, the
 * microphone, and the red strokes the student draws while holding ⇧, which it also shows on
 * screen. Implemented per OS in packages/platform-<os>. Test double: ClipCaptureTest in ../testing.
 */
export class ClipCapture extends Context.Service<
  ClipCapture,
  {
    /**
     * Starts recording into `dir`, which exists; succeeds once it is recording. Records without
     * sound if the microphone is denied. Closing the scope stops it too, but can't report a failure.
     */
    readonly start: (
      dir: string,
    ) => Effect.Effect<
      ClipCaptureHandle,
      ScreenCapturePermissionDenied | ScreenCaptureFailed,
      Scope.Scope
    >;
  }
>()("kladd/core/ClipCapture") {}
