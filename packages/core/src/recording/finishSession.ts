import { renderOverview } from "@kladd/domain";
import { Effect, Option } from "effect";
import { RecordingStore } from "../ports/RecordingStore";
import { Transcriber } from "../ports/Transcriber";

/**
 * Derives the files of a session folder that are made after stop: `transcript.jsonl` (with the
 * language in `session.json`) when there is audio, then `overview.md`. Reads only the raw files,
 * so it can rebuild them at any time. A failed transcription still writes `overview.md`.
 */
export const finishSession = Effect.fn("finishSession")(function* (folder: string) {
  const store = yield* RecordingStore;
  const transcriber = yield* Transcriber;
  const audio = yield* store.audio(folder);
  if (Option.isSome(audio)) {
    yield* transcriber.transcribe(audio.value.audio, audio.value.transcript).pipe(
      Effect.flatMap((language) => store.updateInfo(folder, (info) => ({ ...info, language }))),
      Effect.catchTag("TranscriptionFailed", (error) =>
        Effect.logWarning("Could not transcribe the recording", error.reason),
      ),
    );
  }
  yield* store.writeOverview(folder, renderOverview(yield* store.read(folder)));
});
