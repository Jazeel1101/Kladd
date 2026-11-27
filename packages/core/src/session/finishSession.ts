import { renderOverview } from "@kladd/domain";
import { Effect } from "effect";
import { SessionStore } from "../ports/SessionStore";
import { SummaryAgent } from "../ports/SummaryAgent";
import { Clips } from "./Clips";

/**
 * Derives the files of a session folder that are made once the session has ended: each clip's
 * `transcript.jsonl` (with its language in `clip.json`) when it has sound, then `overview.md`,
 * then `summary.md` from the summary agent unless the session is already logged. Reads only the raw files, so it can rebuild them at
 * any time. A failed transcription still writes `overview.md`, and a failed summary is logged:
 * the student writes their log without it.
 */
export const finishSession = Effect.fn("finishSession")(function* (folder: string) {
  const store = yield* SessionStore;
  yield* (yield* Clips).transcribe(folder);
  const input = yield* store.read(folder);
  yield* store.writeOverview(folder, renderOverview(input));
  if (input.session.loggedAt !== null) return;
  yield* (yield* SummaryAgent)
    .summarize(folder)
    .pipe(
      Effect.catchTag("SummaryFailed", (error) =>
        Effect.logWarning("No summary for the session", error.reason),
      ),
    );
});
