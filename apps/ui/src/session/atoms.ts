import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/**
 * The open session (or null), updated live: it starts, ends and is logged in main, from the pill
 * and its menu, so the UI subscribes instead of refetching.
 */
export const sessionAtom = KladdClient.runtime.atom(
  Stream.unwrap(KladdClient.use((client) => Effect.succeed(client("WatchSession", undefined)))),
);

/** Every session that is not active, newest first, updated on every change. */
export const pastSessionsAtom = KladdClient.runtime.atom(
  Stream.unwrap(
    KladdClient.use((client) => Effect.succeed(client("WatchPastSessions", undefined))),
  ),
);

/** When the clip recording now started (or null), updated on every start and stop. */
export const clipAtom = KladdClient.runtime.atom(
  Stream.unwrap(KladdClient.use((client) => Effect.succeed(client("WatchClip", undefined)))),
);

/** Main shows any error of these itself. Use each with `{ payload: undefined }`. */
export const startSessionAtom = KladdClient.mutation("StartSession");
export const endSessionAtom = KladdClient.mutation("EndSession");
export const finishLoggingAtom = KladdClient.mutation("FinishLogging");
export const takeScreenshotAtom = KladdClient.mutation("TakeScreenshot");
export const toggleClipAtom = KladdClient.mutation("ToggleClip");
export const openLoggingOverlayAtom = KladdClient.mutation("OpenLoggingOverlay");
