import { Transcriber } from "@kladd/core";
import { TranscriptionFailed } from "@kladd/domain";
import { Effect, Layer } from "effect";
import type { CaptureHelper } from "./helper";

/** macOS Transcriber: Whisper large-v3-turbo, with the model kept in `modelDir`. */
export const TranscriberDarwin = (_helper: CaptureHelper, _modelDir: string) =>
  Layer.succeed(
    Transcriber,
    Transcriber.of({
      prepare: Effect.fail(new TranscriptionFailed({ reason: "not implemented" })),
      transcribe: () => Effect.fail(new TranscriptionFailed({ reason: "not implemented" })),
    }),
  );
