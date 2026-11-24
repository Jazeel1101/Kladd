import { SessionCapture } from "@kladd/core";
import { ScreenCaptureFailed } from "@kladd/domain";
import { Effect, Layer } from "effect";
import type { CaptureHelper } from "./helper";

/** macOS SessionCapture: one long-running `kladd-capture session` per recording. */
export const SessionCaptureDarwin = (_helper: CaptureHelper) =>
  Layer.succeed(
    SessionCapture,
    SessionCapture.of({
      start: () => Effect.fail(new ScreenCaptureFailed({ reason: "not implemented" })),
    }),
  );
