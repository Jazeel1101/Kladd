import { renderOverview } from "@kladd/domain";
import { Effect } from "effect";
import { SessionStore } from "../ports/SessionStore";
import { Clips } from "./Clips";

/**
 * Derives the files of a session folder that are made once the session has ended: each clip's
 * `transcript.jsonl` (with its language in `clip.json`) when it has sound, then `overview.md`.
 * Reads only the raw files, so it can rebuild them at any time. A failed transcription still
 * writes `overview.md`.
 */
export const finishSession = Effect.fn("finishSession")(function* (folder: string) {
  const store = yield* SessionStore;
  yield* (yield* Clips).transcribe(folder);
  yield* store.writeOverview(folder, renderOverview(yield* store.read(folder)));
});
