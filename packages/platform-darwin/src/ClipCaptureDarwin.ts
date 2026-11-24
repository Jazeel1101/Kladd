import { ClipCapture } from "@kladd/core";
import { ScreenCaptureFailed } from "@kladd/domain";
import { Effect, Layer } from "effect";
import type { CaptureHelper } from "./helper";

/** macOS ClipCapture: one long-running `kladd-capture clip` per clip. */
export const ClipCaptureDarwin = (_helper: CaptureHelper) =>
  Layer.succeed(
    ClipCapture,
    ClipCapture.of({
      start: () => Effect.fail(new ScreenCaptureFailed({ reason: "not implemented" })),
    }),
  );
