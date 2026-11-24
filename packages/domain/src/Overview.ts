import type { FileChange, SessionInfo, TimelineEvent, TranscriptSegment } from "./SessionFolder";

/** Everything `overview.md` is derived from; all of it can be read back from the session folder. */
export interface OverviewInput {
  readonly session: SessionInfo;
  readonly events: ReadonlyArray<TimelineEvent>;
  readonly files: ReadonlyArray<FileChange>;
  readonly transcript: ReadonlyArray<TranscriptSegment>;
}

/** The text of `overview.md`: the summary agent's map of the session folder. */
export const renderOverview = (_input: OverviewInput): string => "";
