import { DateTime, Option } from "effect";
import {
  clipFiles,
  clipsFolder,
  frameName,
  sessionFiles,
  type ClipInfo,
  type ScreenshotInfo,
  type SessionInfo,
  type TimelineEvent,
} from "./SessionFolder";

/** What the overview says about one clip; never what was said in it. */
export interface OverviewClip {
  /** Its folder's name in `clips/`, from clipName. */
  readonly name: string;
  readonly info: ClipInfo;
  /** It has `audio.m4a`. */
  readonly sound: boolean;
  /** Lines in its `transcript.jsonl`; null when there is none. */
  readonly segments: number | null;
  /** Lines in its `marks.jsonl`. */
  readonly marks: number;
}

/** Everything `overview.md` is derived from; all of it can be read back from the session folder. */
export interface OverviewInput {
  readonly session: SessionInfo;
  /** Empty in manual mode. */
  readonly events: ReadonlyArray<TimelineEvent>;
  /** Oldest first. */
  readonly screenshots: ReadonlyArray<ScreenshotInfo>;
  /** In name order. */
  readonly clips: ReadonlyArray<OverviewClip>;
}

/**
 * Whether a session holds nothing: no screenshot, clip or timeline event. A session that ends
 * like this is discarded rather than logged.
 */
export const isEmptySession = (input: OverviewInput): boolean =>
  input.screenshots.length === 0 && input.clips.length === 0 && input.events.length === 0;

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
const maxFramesPerRow = 6;

const clock = (seconds: number): string => {
  const s = Math.floor(seconds);
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${mm}:${ss}`;
};

const cell = (text: string): string => text.replace(/\s+/g, " ").replaceAll("|", "\\|").trim();

const names = (clips: ReadonlyArray<OverviewClip>): string => clips.map((c) => c.name).join(", ");

/** The text of `overview.md`: the summary agent's map of the session folder. */
export const renderOverview = (input: OverviewInput): string => {
  const auto = input.session.mode === "auto";
  const events = sortedEvents(input.events);
  const start = events.find((event) => event.type === "start");
  const stop = events.find((event) => event.type === "stop");
  const segments = segmentsOf(events);
  // The wall clock at t=0; session.json's start is taken a moment before capture begins.
  const zero = Option.fromNullishOr(start?.at).pipe(
    Option.flatMap((at) => DateTime.make(at)),
    Option.getOrElse((): DateTime.DateTime => input.session.startedAt),
  );
  // To a tenth of a second: a clip's start is added to every time inside its files.
  const onSessionClock = (at: DateTime.Utc): number =>
    Math.max(0, Math.round((DateTime.toEpochMillis(at) - DateTime.toEpochMillis(zero)) / 100) / 10);
  const { endedAt } = input.session;
  const duration =
    stop?.t ?? (endedAt === null ? (events.at(-1)?.t ?? 0) : onSessionClock(endedAt));

  const missing: Array<string> = [];
  if (auto && stop === undefined)
    missing.push(
      `Kladd stopped without a \`stop\` event (a crash): data ends at t=${Math.floor(duration)}.`,
    );
  if (auto && start === undefined)
    missing.push("No `start` event: which permissions were granted is unknown.");
  if (start?.accessibility === false)
    missing.push(
      "No Accessibility permission: `focus` events have app names only (no titles or URLs), keyframes were saved on screen change only, and there is no `focus/` folder.",
    );
  const silent = input.clips.filter((clip) => !clip.sound);
  if (silent.length > 0)
    missing.push(
      `No sound in clip ${names(silent)}: no microphone permission, so no ${clipFiles.audio} or ${clipFiles.transcript}.`,
    );
  const untranscribed = input.clips.filter((clip) => clip.sound && clip.segments === null);
  if (untranscribed.length > 0)
    missing.push(
      `No ${clipFiles.transcript} yet in clip ${names(untranscribed)}: transcription failed or has not run.`,
    );
  const cutShort = input.clips.filter((clip) => clip.info.stoppedAt === null);
  if (cutShort.length > 0)
    missing.push(`No stop time for clip ${names(cutShort)} (a crash): its files may be cut short.`);

  const unplaced = input.screenshots.filter((shot) => shot.focus === null);
  if (unplaced.length > 0)
    missing.push(
      `No focus for ${unplaced.length} screenshot(s): which app was in front is unknown.`,
    );

  const screenshotRows = input.screenshots.map((shot) => {
    const app = shot.focus?.app?.name ?? "*unknown*";
    const where = [shot.focus?.title ?? null, ...(shot.focus?.selection ?? []).map((s) => s.text)]
      .filter((part) => part !== null)
      .join(" — ");
    return `| ${onSessionClock(shot.takenAt)} | ${sessionFiles.screenshots}/${shot.id}.png | ${cell(app)} | ${cell(where)} |`;
  });

  const rows = segments.map((segment) => {
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
    return `| ${Math.floor(segment.from)}–${Math.floor(segment.to)} | ${cell(app)} | ${cell(title)} | ${frames} |`;
  });

  const clipRows = input.clips.map((clip) => {
    const from = onSessionClock(clip.info.startedAt);
    const to = clip.info.stoppedAt === null ? "?" : onSessionClock(clip.info.stoppedAt);
    const transcript =
      clip.segments === null ? "no" : clip.segments === 0 ? "empty" : `${clip.segments} lines`;
    return `| ${clip.name} | ${from}–${to} | ${clipsFolder}/${clip.name}/ | ${clip.sound ? "yes" : "no"} | ${transcript} | ${clip.marks} |`;
  });

  const f = sessionFiles;
  const c = clipFiles;
  return [
    "# Session overview",
    "",
    `${auto ? "Automatic" : "Manual"} session, started ${DateTime.formatIso(input.session.startedAt)}. Duration ${clock(duration)} (t=0–${Math.floor(duration)}). Screenshots: ${input.screenshots.length}. Clips: ${input.clips.length}.`,
    "",
    ...(missing.length > 0 ? ["Missing data:", ...missing.map((line) => `- ${line}`), ""] : []),
    "## How to read this folder",
    "",
    "- One clock: `t` is seconds since the session started, in every file and file name outside `clips/`.",
    `- \`${f.session}\`: start and end time, and the capture mode: ${auto ? "automatic, so Kladd also saved keyframes of the screen" : "manual, so there is nothing but what the student took"}.`,
    `- \`${f.screenshots}/<id>.png\`: screenshots the student took. \`${f.screenshots}/<id>.json\` beside each: when it was taken (\`takenAt\`) and \`focus\`, the app, window title and selected rows (such as the current page) in front at that moment.`,
    ...(auto
      ? [
          `- \`${f.timeline}\`: every event, one JSON object per line, with \`type\` start, stop, focus, frame, idle, active or activity (key and click counts every 10 s, never what was typed). Lines can be out of \`t\` order; sort by \`t\`.`,
          `- \`${f.frames}/<t>.jpg\`: keyframes (6-digit \`t\`, e.g. ${frameName(65)}.jpg is t=65); \`${f.frames}/<t>.txt\` is its OCR text, missing when OCR failed. \`${f.focus}/<t>.json\`: the focused window at that keyframe.`,
          `- Search the \`.jsonl\` files for what you need, such as \`"type":"focus"\` in \`${f.timeline}\`, rather than reading them whole.`,
        ]
      : [
          `- Search the JSON files for what you need, such as \`"app"\` in \`${f.screenshots}/*.json\`, rather than reading them all.`,
        ]),
    "",
    "## Screenshots",
    "",
    ...(input.screenshots.length === 0
      ? ["None."]
      : [
          "Oldest first. The student took each one to show something; they matter more than anything Kladd saved by itself.",
          "",
          "| t | File | App | Window / selection |",
          "| --- | --- | --- | --- |",
          ...screenshotRows,
        ]),
    "",
    ...(auto
      ? [
          "## Segments",
          "",
          `One row per stretch in one app and title, or per idle period (no input for 60 s or more). Stretches under ${flickerSeconds} s are merged into the next row; see \`${f.timeline}\` for every switch. Keyframes are \`${f.frames}/<name>.jpg\`, at most ${maxFramesPerRow} listed per row.`,
          "",
          "| t | App | Title / URL | Keyframes |",
          "| --- | --- | --- | --- |",
          ...rows,
          "",
        ]
      : []),
    "## Clips",
    "",
    ...(input.clips.length === 0
      ? ["None."]
      : [
          "A clip is a whole-screen video with sound that the student took to show and explain something. What was said is not in this overview; read each clip's transcript.",
          "",
          `- \`${clipsFolder}/<name>/\`: \`${c.video}\` the whole screen with the student's red strokes drawn in, \`${c.audio}\` the microphone, \`${c.transcript}\` what was said as \`{t, end, text}\` per line, \`${c.marks}\` the strokes as \`{t, end, points}\` per line (\`[x, y]\` points on the main display from its top-left corner), \`${c.clip}\` start, stop and spoken language.`,
          "- Times inside a clip's files are seconds since that clip started. Add the clip's start below to get session `t`.",
          "",
          "| Clip | t | Folder | Sound | Transcript | Marks |",
          "| --- | --- | --- | --- | --- | --- |",
          ...clipRows,
        ]),
    "",
  ].join("\n");
};
