import { ScreenCapture } from "@kladd/core";
import { Effect, Layer } from "effect";

/**
 * macOS ScreenCapture. STUB: logs instead of capturing.
 * Real version: check screen-recording permission, then start a ScreenCaptureKit stream.
 */
export const ScreenCaptureDarwin = Layer.succeed(
  ScreenCapture,
  ScreenCapture.of({
    start: Effect.logInfo("ScreenCaptureDarwin.start (stub: not capturing yet)"),
  }),
);
