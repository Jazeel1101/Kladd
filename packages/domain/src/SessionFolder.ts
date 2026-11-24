import { Schema } from "effect";
import { RecordingSessionId } from "./RecordingSession";

/**
 * The folder one recording is written to (GLOSSARY: "opptaksmappe"), and the contract between
 * capture and the summary agent, which is only told to start with `overview.md`.
 * Every `t` is seconds since the recording started; frame and focus files are named after it.
 */
export const sessionFiles = {
  /** SessionInfo. */
  session: "session.json",
  /** Live: one TimelineEvent per line. Lines can be slightly out of `t` order; sort before use. */
  timeline: "timeline.jsonl",
  /** Live: one FileChange per line, each path once. */
  files: "files.jsonl",
  /** Live: the screen at lower resolution. */
  video: "screen.mp4",
  /** Live: `<t>.jpg` keyframes at full resolution, with `<t>.txt` OCR text beside them. */
  frames: "frames",
  /** Live: `<t>.json`, the FocusSnapshot at each keyframe. */
  focus: "focus",
  /** Live: the microphone. Missing without microphone permission. */
  audio: "audio.m4a",
  /** After stop: one TranscriptSegment per line. */
  transcript: "transcript.jsonl",
  /** After stop: the agent's map, from renderOverview. */
  overview: "overview.md",
  /** Written by the summary agent. */
  summary: "summary.md",
} as const;

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
    /** False without microphone permission: there is no `audio.m4a`. */
    microphone: Schema.Boolean,
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
  /** A keyframe was saved (GLOSSARY: "nøkkelbilde"). `file` and `ocr` are relative to the folder. */
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

/** One line of `files.jsonl`: a file that changed during the recording. */
export const FileChange = Schema.Struct({
  /** When it first changed. */
  t,
  /** Absolute path. */
  path: Schema.String,
});
export type FileChange = typeof FileChange.Type;

/** One line of `transcript.jsonl`: what was said from `t` to `end`. */
export const TranscriptSegment = Schema.Struct({
  t,
  end: Schema.Number,
  text: Schema.String,
});
export type TranscriptSegment = typeof TranscriptSegment.Type;

/** `session.json`. */
export const SessionInfo = Schema.Struct({
  id: RecordingSessionId,
  startedAt: Schema.DateTimeUtc,
  /** Null while recording, and after a crash. */
  stoppedAt: Schema.NullOr(Schema.DateTimeUtc),
  /** The spoken language Whisper detected, such as "no". Null without a transcript. */
  language: Schema.NullOr(Schema.String),
  /** Kladd's version. */
  appVersion: Schema.String,
  /** Version of this folder layout. */
  layout: Schema.Literal(1),
});
export type SessionInfo = typeof SessionInfo.Type;

/**
 * Apps whose windows are left out of the video and keyframes, and whose files are never listed
 * or readable: password managers and Messages.
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
 * A path containing one of these is private: never listed in `files.jsonl` and never readable by
 * the summary agent. Caches, Apple background services, credentials and excluded apps.
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

/** Changes that say nothing about what the student did; left out of `files.jsonl` only. */
export const noisyPathFragments: ReadonlyArray<string> = [
  "/.git/",
  "/node_modules/",
  "/.Trash/",
  "/Library/Logs/",
  "/.DS_Store",
];

export const isDeniedPath = (path: string): boolean =>
  deniedPathFragments.some((fragment) => path.includes(fragment));

/** Speech could not be turned into text: no model yet, a missing helper, an unreadable file. */
export class TranscriptionFailed extends Schema.TaggedError<
  TranscriptionFailed,
  { readonly brand: unique symbol }
>()("TranscriptionFailed", { reason: Schema.String }) {}
