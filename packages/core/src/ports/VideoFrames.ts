import type { VideoFrameFailed } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: one frame of a video as a JPEG, so the summary agent can look at a moment of a clip.
 * Implemented per OS in packages/platform-<os>. Test double: VideoFramesTest in ../testing.
 */
export class VideoFrames extends Context.Service<
  VideoFrames,
  {
    /** Writes the frame of `video` at `t` seconds to `out`, making its folder if needed. */
    readonly frameAt: (
      video: string,
      t: number,
      out: string,
    ) => Effect.Effect<void, VideoFrameFailed>;
  }
>()("kladd/core/VideoFrames") {}
