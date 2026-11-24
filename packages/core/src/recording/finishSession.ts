import { renderOverview } from "@kladd/domain";
import { Effect } from "effect";
import { RecordingStore } from "../ports/RecordingStore";
import { Clips } from "./Clips";

/**
 * Derives the files of a session folder that are made after stop: each clip's
 * `transcript.jsonl` (with its language in `clip.json`) when it has sound, then `overview.md`.
 * Reads only the raw files, so it can rebuild them at any time. A failed transcription still
 * writes `overview.md`.
 */
export const finishSession = Effect.fn("finishSession")(function* (folder: string) {
  const store = yield* RecordingStore;
  yield* (yield* Clips).transcribe(folder);
  yield* store.writeOverview(folder, renderOverview(yield* store.read(folder)));
});
