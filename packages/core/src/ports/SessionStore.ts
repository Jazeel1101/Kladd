import type {
  ClipInfo,
  OverviewInput,
  ScreenshotId,
  ScreenshotInfo,
  Session,
  SessionId,
} from "@kladd/domain";
import { Context, type Effect, type Option } from "effect";

/** A session and the folder it is written to. */
export interface StoredSession {
  readonly folder: string;
  readonly session: Session;
}

/** A clip with sound and no transcript yet: its folder, its audio, and where its transcript goes. */
export interface UntranscribedClip {
  readonly folder: string;
  readonly audio: string;
  readonly transcript: string;
}

/**
 * Port: persists work sessions (GLOSSARY: "økt") as session folders (GLOSSARY: "opptaksmappe"), and
 * the files Kladd itself writes in them; SessionCapture writes the rest. A folder is the path
 * `create` returns. The folder is the only record of a session, so it outlives quitting and crashes.
 * Implemented in packages/infra. Test double: SessionStoreTest in ../testing.
 */
export class SessionStore extends Context.Service<
  SessionStore,
  {
    /** Every session, newest first. */
    readonly list: Effect.Effect<ReadonlyArray<StoredSession>>;
    /** Creates the session's folder with its `session.json`. Returns the folder. */
    readonly create: (session: Session) => Effect.Effect<string>;
    /** Rewrites the folder's `session.json` as `session`. */
    readonly update: (folder: string, session: Session) => Effect.Effect<void>;
    /** Deletes the folder of a session that never started. */
    readonly remove: (folder: string) => Effect.Effect<void>;
    /** The folder `create` made for `id`, if it did. */
    readonly folder: (id: SessionId) => Effect.Effect<Option.Option<string>>;
    /**
     * Whether the folder has `overview.md`, a transcript for every clip with sound, and
     * `summary.md` unless the session is logged: a log written without one needs none.
     */
    readonly finished: (folder: string) => Effect.Effect<boolean>;
    /** The folder's `summary.md`, once the summary agent has written it. */
    readonly summary: (folder: string) => Effect.Effect<Option.Option<string>>;
    /** Where the screenshot `id` goes as a PNG in the folder. Its directory exists once this succeeds. */
    readonly screenshotFile: (folder: string, id: ScreenshotId) => Effect.Effect<string>;
    /** Writes the screenshot's `<id>.json` beside its PNG. */
    readonly saveScreenshot: (folder: string, info: ScreenshotInfo) => Effect.Effect<void>;
    /** The folder's screenshots, oldest first. Skips any whose `<id>.json` doesn't decode. */
    readonly screenshots: (folder: string) => Effect.Effect<ReadonlyArray<ScreenshotInfo>>;
    /** Creates the session folder's next clip folder, `clips/<clipName>`, with `info`. Returns it. */
    readonly createClip: (folder: string, info: ClipInfo) => Effect.Effect<string>;
    /** Deletes a clip folder that recorded nothing; only the last one, so clip names stay in order. */
    readonly removeClip: (clip: string) => Effect.Effect<void>;
    /** Changes a clip folder's `clip.json`. */
    readonly updateClip: (
      clip: string,
      update: (info: ClipInfo) => ClipInfo,
    ) => Effect.Effect<void>;
    /** The session folder's clips with `audio.m4a` and no `transcript.jsonl`, in order. */
    readonly untranscribed: (folder: string) => Effect.Effect<ReadonlyArray<UntranscribedClip>>;
    /**
     * Reads back everything `overview.md` is made from. Skips lines that don't decode, such as a
     * last line cut off by a crash, and files that don't exist.
     */
    readonly read: (folder: string) => Effect.Effect<OverviewInput>;
    readonly writeOverview: (folder: string, text: string) => Effect.Effect<void>;
  }
>()("kladd/core/SessionStore") {}
