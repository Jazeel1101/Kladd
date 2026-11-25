import type { TranscriptionFailed } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: speech to text with Whisper large-v3-turbo, on the Mac. Always transcribes in the spoken
 * language, never translates. Implemented per OS in packages/platform-<os>.
 * Test double: TranscriberTest in ../testing.
 */
export class Transcriber extends Context.Service<
  Transcriber,
  {
    /** Downloads the model if it is missing. Kladd runs it in the background when it opens. */
    readonly prepare: Effect.Effect<void, TranscriptionFailed>;
    /**
     * Writes `audioFile`'s speech to `transcriptFile`, one TranscriptSegment per line, and returns
     * the language it detected, such as "no". Writes the file even when nobody speaks: a clip with
     * sound is finished only once it has one.
     */
    readonly transcribe: (
      audioFile: string,
      transcriptFile: string,
    ) => Effect.Effect<string, TranscriptionFailed>;
  }
>()("kladd/core/Transcriber") {}
