import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/**
 * The active recording (or null), updated live: the pill menu starts and stops recordings in main,
 * so the UI subscribes instead of refetching.
 */
export const recordingAtom = KladdClient.runtime.atom(
  Stream.unwrap(KladdClient.use((client) => Effect.succeed(client("WatchRecording", undefined)))),
);
