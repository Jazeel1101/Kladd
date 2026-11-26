import { Schema } from "effect";
import { FocusSnapshot } from "./Focus";
import { Screenshot } from "./Screenshot";
import { Session, fieldsOf } from "./Session";

/**
 * The folder one work session is written to (GLOSSARY: "opptaksmappe"), and the contract between
 * capture and the summary agent, which is only told to start with `overview.md`.
 * Every `t` is seconds since the session started; frame and focus files are named after it.
 * Screenshots the student took are in `screenshots/`, clips in `clips/` (clipsFolder), each clip
 * with its own clock. The timeline, frames and focus are written in auto mode only.
 */
export const sessionFiles = {
  /** SessionInfo. */
  session: "session.json",
  /** `<id>.png`, each with its ScreenshotInfo as `<id>.json`. */
  screenshots: "screenshots",
  /** Live, auto mode: one TimelineEvent per line. Lines can be slightly out of `t` order; sort before use. */
  timeline: "timeline.jsonl",
  /** Live, auto mode: `<t>.jpg` keyframes at full resolution, with `<t>.txt` OCR text beside them. */
  frames: "frames",
  /** Live, auto mode: `<t>.json`, the FocusSnapshot at each keyframe. */
  focus: "focus",
  /** After stop: the agent's map, from renderOverview. */
  overview: "overview.md",
  /** Written by the summary agent. */
  summary: "summary.md",
} as const;

/** The session folder's `clips/`: one folder per clip, named by clipName. */
export const clipsFolder = "clips";

/**
 * The files of one clip (GLOSSARY: "klipp"): a whole-screen video with sound, taken with ⌥⇧C
 * inside a work session. Times in a clip's files are seconds since that clip started.
 */
export const clipFiles = {
  /** ClipInfo. */
  clip: "clip.json",
  /** Live: the whole main display, with the ink drawn on it. */
  video: "screen.mp4",
  /** Live: the microphone. Missing without microphone permission. */
  audio: "audio.m4a",
  /** Live: one Mark per line. */
  marks: "marks.jsonl",
  /** After the clip stops: one TranscriptSegment per line. */
  transcript: "transcript.jsonl",
} as const;

/** The folder name of a session's nth clip, from 1: 3 -> "003". */
export const clipName = (n: number): string => String(n).padStart(3, "0");

/** `clip.json`. */
export const ClipInfo = Schema.Struct({
  startedAt: Schema.DateTimeUtc,
  /** Null while it records, and after a crash. */
  stoppedAt: Schema.NullOr(Schema.DateTimeUtc),
  /** The spoken language Whisper detected, such as "no". Null without a transcript. */
  language: Schema.NullOr(Schema.String),
});
export type ClipInfo = typeof ClipInfo.Type;

/**
 * One line of a clip's `marks.jsonl`: a red stroke the student drew on the screen
 * (GLOSSARY: "strek"), from `t` to `end`.
 */
export const Mark = Schema.Struct({
  t: Schema.Number,
  end: Schema.Number,
  /** The stroke as [x, y] in points on the main display, from its top-left corner. */
  points: Schema.Array(Schema.Tuple([Schema.Number, Schema.Number])),
});
export type Mark = typeof Mark.Type;

/** `t` as a frame or focus file's name, without extension: 815 -> "000815". */
export const frameName = (t: number): string => String(Math.floor(t)).padStart(6, "0");

const t = Schema.Number;

/** One line of `timeline.jsonl` (GLOSSARY: "tidslinje"). */
export const TimelineEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start"),
    t,
    /** Wall clock at t=0, ISO 8601 UTC. */
    at: Schema.String,
    /** False without Accessibility permission: `focus` events then carry app names only. */
    accessibility: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("stop"), t, at: Schema.String }),
  /** The app, window, title or URL in front changed. */
  Schema.Struct({
    type: Schema.Literal("focus"),
    t,
    app: Schema.String,
    bundleId: Schema.String,
    title: Schema.NullOr(Schema.String),
    url: Schema.optional(Schema.String),
  }),
  /**
   * A keyframe was saved (GLOSSARY: "nøkkelbilde"). `file` and `ocr` are relative to the folder.
   * `ocr` is where its OCR text goes; that file is missing when OCR failed or had not finished.
   */
  Schema.Struct({
    type: Schema.Literal("frame"),
    t,
    file: Schema.String,
    reason: Schema.Literals(["focus", "change"]),
    ocr: Schema.NullOr(Schema.String),
  }),
  /** No input for 60 s. */
  Schema.Struct({ type: Schema.Literal("idle"), t }),
  /** Input again after `idle`. */
  Schema.Struct({ type: Schema.Literal("active"), t }),
  /** Every 10 s while active: counts since the last one, never what was typed. */
  Schema.Struct({
    type: Schema.Literal("activity"),
    t,
    keys: Schema.Number,
    clicks: Schema.Number,
  }),
]);
export type TimelineEvent = typeof TimelineEvent.Type;

/** One line of a clip's `transcript.jsonl`: what was said from `t` to `end`. */
export const TranscriptSegment = Schema.Struct({
  t,
  end: Schema.Number,
  text: Schema.String,
});
export type TranscriptSegment = typeof TranscriptSegment.Type;

/** `session.json`: the Session, rewritten as it ends and is logged. */
export const SessionInfo = Schema.Struct({
  ...Session.fields,
  /** Kladd's version. */
  appVersion: Schema.String,
  /** Version of this folder layout. */
  layout: Schema.Literal(2),
});
export type SessionInfo = typeof SessionInfo.Type;

/** The `session.json` of `session`, started with Kladd `appVersion`. */
export const sessionInfo = (session: Session, appVersion: string): SessionInfo => ({
  ...fieldsOf(session),
  appVersion,
  layout: 2,
});

/** `screenshots/<id>.json`: a screenshot, and where the student was when they took it. */
export const ScreenshotInfo = Schema.Struct({
  ...Screenshot.fields,
  /** Null when focus could not be read. */
  focus: Schema.NullOr(FocusSnapshot),
});
export type ScreenshotInfo = typeof ScreenshotInfo.Type;

/**
 * Apps whose windows are left out of the video and keyframes, and whose files are never readable: password managers and Messages.
 */
export const excludedApps: ReadonlyArray<string> = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.lastpass.LastPass",
  "com.dashlane.dashlanephonefinal",
  "com.apple.keychainaccess",
  "com.apple.Passwords",
  "com.apple.MobileSMS",
];

/**
 * A path containing one of these is private: never readable by the summary agent. Caches, Apple background services, credentials and excluded apps.
 */
export const deniedPathFragments: ReadonlyArray<string> = [
  "/Library/Caches/",
  "/Library/Keychains/",
  "/Library/Cookies/",
  "/Library/Messages/",
  "/Library/Biome/",
  "/Library/Application Support/AppleMediaServices",
  "/Library/Application Support/com.apple.",
  "/Library/Containers/com.apple.",
  "/Library/Group Containers/group.com.apple.",
  "/Library/Daemon Containers/",
  "/Library/Metadata/",
  "/Library/Saved Application State/",
  "/com.apple.routined",
  "/ScreenTimeAgent",
  "/.ssh/",
  "/.gnupg/",
  "/.aws/",
  "/.netrc",
  ...excludedApps.map((bundleId) => `/${bundleId}`),
];

export const isDeniedPath = (path: string): boolean =>
  deniedPathFragments.some((fragment) => path.includes(fragment));

/**
 * Focus as a session folder may keep it: an excluded app's window title and selected rows (a
 * conversation, a vault) are as private as its windows, which captures leave out.
 */
export const shareableFocus = (focus: FocusSnapshot): FocusSnapshot =>
  focus.app !== null && excludedApps.includes(focus.app.bundleId)
    ? { ...focus, title: null, selection: [] }
    : focus;

/** Speech could not be turned into text: no model yet, a missing helper, an unreadable file. */
export class TranscriptionFailed extends Schema.TaggedError<
  TranscriptionFailed,
  { readonly brand: unique symbol }
>()("TranscriptionFailed", { reason: Schema.String }) {}
