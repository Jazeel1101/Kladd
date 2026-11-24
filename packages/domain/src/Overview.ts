import { DateTime } from "effect";
import {
  frameName,
  sessionFiles,
  type FileChange,
  type SessionInfo,
  type TimelineEvent,
  type TranscriptSegment,
} from "./SessionFolder";

/** Everything `overview.md` is derived from; all of it can be read back from the session folder. */
export interface OverviewInput {
  readonly session: SessionInfo;
  readonly events: ReadonlyArray<TimelineEvent>;
  readonly files: ReadonlyArray<FileChange>;
  readonly transcript: ReadonlyArray<TranscriptSegment>;
}

/** What was in front from `from` to `to`, or `null` while the student was idle. */
export interface Focused {
  readonly app: string;
  readonly bundleId: string;
  readonly title: string | null;
  readonly url: string | null;
}

/** One row of the overview: a stretch in one app and title, or one idle period. */
export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly focus: Focused | null;
  readonly idle: boolean;
  /** `t` of each keyframe saved in this stretch. */
  readonly frames: ReadonlyArray<number>;
}

/** A focus stretch shorter than this is a flicker and joins the row before it. */
export const flickerSeconds = 15;

const sameFocus = (a: Focused | null, b: Focused | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.bundleId === b.bundleId &&
    a.app === b.app &&
    a.title === b.title &&
    a.url === b.url);

/** Events in `t` order; capture can append them slightly out of order. */
export const sortedEvents = (events: ReadonlyArray<TimelineEvent>): ReadonlyArray<TimelineEvent> =>
  events.toSorted((a, b) => a.t - b.t);

/**
 * The timeline as rows an agent reads at a glance. A row is a stretch in one app, title and URL,
 * or one idle period (`idle` to `active`, focus changes inside it ignored). A stretch shorter than
 * `flickerSeconds` joins the row after it (the last one joins the row before it), and rows with
 * the same focus next to each other are joined, so a quick look at another app does not split a row.
 * Keyframes go to the row they were saved in. The last row ends at `stop`, or at the last event
 * after a crash.
 */
export const segmentsOf = (events: ReadonlyArray<TimelineEvent>): ReadonlyArray<Segment> => {
  const sorted = sortedEvents(events);
  const end = sorted.findLast((event) => event.type === "stop")?.t ?? sorted.at(-1)?.t ?? 0;

  type Row = { -readonly [K in keyof Segment]: Segment[K] } & { frames: Array<number> };
  const raw: Array<Row> = [];
  let focus: Focused | null = null;
  let idle = false;
  let open: Row = { from: 0, to: 0, focus, idle, frames: [] };
  const switchTo = (t: number) => {
    raw.push({ ...open, to: t });
    open = { from: t, to: t, focus, idle, frames: [] };
  };
  for (const event of sorted) {
    if (event.t > end) break;
    switch (event.type) {
      case "focus":
        focus = {
          app: event.app,
          bundleId: event.bundleId,
          title: event.title,
          url: event.url ?? null,
        };
        if (!idle && !sameFocus(open.focus, focus)) switchTo(event.t);
        break;
      case "idle":
        if (!idle) {
          idle = true;
          switchTo(event.t);
        }
        break;
      case "active":
        if (idle) {
          idle = false;
          switchTo(event.t);
        }
        break;
      case "frame":
        open.frames.push(event.t);
        break;
    }
  }
  raw.push({ ...open, to: end });

  // Backwards, so a run of flickers (Safari, Slack, Safari again) all join the stretch they lead to.
  const rows: Array<Row> = [];
  for (const segment of raw.toReversed()) {
    const next = rows.at(-1);
    if (
      next !== undefined &&
      (segment.to - segment.from < flickerSeconds ||
        (next.idle === segment.idle && sameFocus(next.focus, segment.focus)))
    ) {
      next.from = segment.from;
      next.frames.unshift(...segment.frames);
    } else {
      rows.push(segment);
    }
  }
  rows.reverse();
  // The last stretch has no row after it, so a short one joins the row before it.
  const last = rows.at(-1);
  const before = rows.at(-2);
  if (last !== undefined && before !== undefined && last.to - last.from < flickerSeconds) {
    before.to = last.to;
    before.frames.push(...last.frames);
    rows.pop();
  }
  return rows;
};

/** Caps on what could grow without bound; the full data stays in the files the text names. */
const maxSpeechChars = 300;
const maxFramesPerRow = 6;
const maxFilesPerFolder = 8;

const clock = (seconds: number): string => {
  const s = Math.floor(seconds);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${mm}:${ss}`;
};

const cell = (text: string): string => text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const dirname = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 1));

/** The text of `overview.md`: the summary agent's map of the session folder. */
export const renderOverview = (input: OverviewInput): string => {
  const events = sortedEvents(input.events);
  const start = events.find((event) => event.type === "start");
  const stop = events.find((event) => event.type === "stop");
  const segments = segmentsOf(events);
  const duration = stop?.t ?? events.at(-1)?.t ?? 0;
  const transcript = input.transcript.toSorted((a, b) => a.t - b.t);

  const missing: Array<string> = [];
  if (stop === undefined)
    missing.push(
      `Kladd stopped without a \`stop\` event (a crash): data ends at t=${Math.floor(duration)}, and ${sessionFiles.video} may be cut short.`,
    );
  if (start === undefined)
    missing.push("No `start` event: which permissions were granted is unknown.");
  if (start?.accessibility === false)
    missing.push(
      "No Accessibility permission: `focus` events have app names only (no titles or URLs), keyframes were saved on screen change only, and there is no `focus/` folder.",
    );
  if (start?.microphone === false)
    missing.push(`No microphone: no ${sessionFiles.audio} and no speech.`);
  else if (transcript.length === 0)
    missing.push(`No transcript: ${sessionFiles.transcript} is missing or empty.`);

  const speechIn = (segment: Segment, last: boolean): string =>
    cut(
      transcript
        .filter((s) => s.t >= segment.from && (s.t < segment.to || (last && s.t <= segment.to)))
        .map((s) => s.text.trim())
        .join(" "),
      maxSpeechChars,
    );

  const rows = segments.map((segment, index) => {
    const [app, title] = segment.idle
      ? ["*idle*", ""]
      : segment.focus === null
        ? ["*unknown*", ""]
        : [
            segment.focus.app,
            [segment.focus.title, segment.focus.url].filter((part) => part !== null).join(" — "),
          ];
    const shown = segment.frames.slice(0, maxFramesPerRow).map(frameName).join(" ");
    const more = segment.frames.length - maxFramesPerRow;
    const frames = more > 0 ? `${shown} +${more}` : shown;
    const speech = speechIn(segment, index === segments.length - 1);
    return `| ${Math.floor(segment.from)}–${Math.floor(segment.to)} | ${cell(app)} | ${cell(title)} | ${frames} | ${cell(speech)} |`;
  });

  const byFolder = Map.groupBy(
    input.files.toSorted((a, b) => a.path.localeCompare(b.path)),
    (file) => dirname(file.path),
  );
  const folders = [...byFolder].map(([folder, files]) => {
    const listed = files
      .slice(0, maxFilesPerFolder)
      .map((file) => `- ${file.path.slice(folder.length + 1)} (t=${Math.floor(file.t)})`);
    const more = files.length - maxFilesPerFolder;
    return [`${folder}/`, ...listed, ...(more > 0 ? [`- +${more} more`] : [])].join("\n");
  });

  const language = input.session.language ?? "unknown";
  const f = sessionFiles;
  return [
    "# Session overview",
    "",
    `Started ${DateTime.formatIso(input.session.startedAt)}. Duration ${clock(duration)} (t=0–${Math.floor(duration)}). Spoken language: ${language}.`,
    "",
    ...(missing.length > 0 ? ["Missing data:", ...missing.map((line) => `- ${line}`), ""] : []),
    "## How to read this folder",
    "",
    "- One clock: `t` is seconds since the recording started, in every file and file name.",
    `- \`${f.timeline}\`: every event, one JSON object per line, with \`type\` start, stop, focus, frame, idle, active or activity (key and click counts every 10 s, never what was typed). Lines can be out of \`t\` order; sort by \`t\`.`,
    `- \`${f.frames}/<t>.jpg\`: keyframes (6-digit \`t\`, e.g. ${frameName(65)}.jpg is t=65); \`${f.frames}/<t>.txt\` is its OCR text, missing when OCR failed. \`${f.focus}/<t>.json\`: the focused window at that keyframe.`,
    `- \`${f.transcript}\`: speech, \`{t, end, text}\` per line. \`${f.files}\`: changed files, \`{t, path}\` per line. \`${f.session}\`: start, stop, language. \`${f.video}\`: the whole screen.`,
    `- Use \`jq\` and \`grep\` on the \`.jsonl\` files, e.g. \`jq -c 'select(.type=="focus")' ${f.timeline}\`. There is no Python.`,
    "",
    "## Segments",
    "",
    `One row per stretch in one app and title, or per idle period (no input for 60 s or more). Stretches under ${flickerSeconds} s are merged into the next row; see \`${f.timeline}\` for every switch. Keyframes are \`${f.frames}/<name>.jpg\`, at most ${maxFramesPerRow} listed per row; speech is cut at ${maxSpeechChars} characters (full text in \`${f.transcript}\`).`,
    "",
    "| t | App | Title / URL | Keyframes | Speech |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Files changed",
    "",
    input.files.length === 0
      ? "None."
      : `${input.files.length} files, by folder, with the \`t\` each first changed. At most ${maxFilesPerFolder} per folder; all of them are in \`${f.files}\`.`,
    ...(folders.length > 0 ? ["", folders.join("\n\n")] : []),
    "",
  ].join("\n");
};
