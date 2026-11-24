import type {
  ClipInfo,
  OverviewInput,
  RecordingSession,
  RecordingSessionId,
  SessionInfo,
} from "@kladd/domain";
import { Context, type Effect, type Option } from "effect";

/** A clip with sound and no transcript yet: its folder, its audio, and where its transcript goes. */
export interface UntranscribedClip {
  readonly folder: string;
  readonly audio: string;
  readonly transcript: string;
}

/**
 * Port: persists recording sessions and the files Kladd itself writes in their session folders
 * (GLOSSARY: "opptaksmappe"); SessionCapture writes the rest. A folder is the path it returns.
 * Implemented in packages/infra. Test double: RecordingStoreTest in ../testing.
 */
export class RecordingStore extends Context.Service<
  RecordingStore,
  {
    readonly active: Effect.Effect<Option.Option<RecordingSession>>;
    /**
     * Creates the session's folder with its `session.json` (not stopped yet) and
     * makes it the active session. Returns the folder.
     */
    readonly save: (session: RecordingSession) => Effect.Effect<string>;
    /** Forgets the active session; its folder stays. */
    readonly clear: Effect.Effect<void>;
    /**
     * Every session folder not finished yet: without `overview.md`, or with an untranscribed clip.
     * Includes the active session's.
     */
    readonly unfinished: Effect.Effect<ReadonlyArray<string>>;
    /** The folder `save` created for `id`, if it did. */
    readonly folder: (id: RecordingSessionId) => Effect.Effect<Option.Option<string>>;
    /** Changes the folder's `session.json`. */
    readonly updateInfo: (
      folder: string,
      update: (info: SessionInfo) => SessionInfo,
    ) => Effect.Effect<void>;
    /** Creates the session folder's next clip folder, `clips/<clipName>`, with `info`. Returns it. */
    readonly createClip: (folder: string, info: ClipInfo) => Effect.Effect<string>;
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
>()("kladd/core/RecordingStore") {}
