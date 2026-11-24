import { DateTime } from "effect";
import type { RecordingSessionId } from "./RecordingSession";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The name of a session folder: `<YYYY-MM-DD_HHmm>_<id>`, in the zone `startedAt` is in (the Mac's
 * local time), so folders sort by start and a student can find one by when they recorded.
 */
export const sessionFolderName = (id: RecordingSessionId, startedAt: DateTime.Zoned): string => {
  const p = DateTime.toParts(startedAt);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}${pad(p.minute)}_${id}`;
};

/** Whether `name` is the session folder of `id`, whatever time zone it was named in. */
export const isSessionFolderOf = (name: string, id: RecordingSessionId): boolean =>
  name.endsWith(`_${id}`);
