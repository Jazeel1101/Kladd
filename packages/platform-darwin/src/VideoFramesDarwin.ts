import { VideoFrames } from "@kladd/core";
import { VideoFrameFailed } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, describeFailure, runHelper } from "./helper";

/** macOS VideoFrames: `kladd-capture frame`, one process per frame (AVAssetImageGenerator). */
export const VideoFramesDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    VideoFrames,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const frameAt = Effect.fn("VideoFramesDarwin.frameAt")(function* (
        video: string,
        t: number,
        out: string,
      ) {
        const result = yield* runHelper(spawner, helper, [
          "frame",
          "--video",
          video,
          "--at",
          String(t),
          "--out",
          out,
        ]).pipe(Effect.mapError((cause) => new VideoFrameFailed({ reason: String(cause) })));
        if (result.exitCode !== 0) {
          return yield* new VideoFrameFailed({ reason: describeFailure(result) });
        }
      });
      return VideoFrames.of({ frameAt });
    }),
  );
