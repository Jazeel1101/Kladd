import { Transcriber } from "@kladd/core";
import { TranscriptionFailed } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, describeFailure, type HelperResult, runHelper } from "./helper";

const failed = (cause: unknown) =>
  new TranscriptionFailed({ reason: cause instanceof Error ? cause.message : String(cause) });

/**
 * macOS Transcriber: Whisper large-v3-turbo through WhisperKit, in the `kladd-transcribe` helper
 * beside kladd-capture (../native/Sources/KladdTranscribe), with the model kept in `modelDir`.
 * See docs/internals/transcription.md.
 */
export const TranscriberDarwin = (helper: CaptureHelper, modelDir: string) =>
  Layer.effect(
    Transcriber,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const transcriber = {
        ...helper,
        path: helper.path.replace(/kladd-capture$/, "kladd-transcribe"),
      };
      // Both commands print one line when they succeed: "ready", or the detected language.
      const run = (args: ReadonlyArray<string>) =>
        runHelper(spawner, transcriber, [...args, "--model-dir", modelDir]).pipe(
          Effect.mapError(failed),
          Effect.flatMap((result: HelperResult) => {
            const line = result.stdout.split("\n").at(-1) ?? "";
            return result.exitCode === 0 && line !== ""
              ? Effect.succeed(line)
              : Effect.fail(new TranscriptionFailed({ reason: describeFailure(result) }));
          }),
        );

      const prepare = run(["prepare"]).pipe(
        Effect.asVoid,
        Effect.withSpan("TranscriberDarwin.prepare"),
      );

      const transcribe = (audioFile: string, transcriptFile: string) =>
        run(["transcribe", "--audio", audioFile, "--out", transcriptFile]).pipe(
          Effect.withSpan("TranscriberDarwin.transcribe"),
        );

      return Transcriber.of({ prepare, transcribe });
    }),
  );
