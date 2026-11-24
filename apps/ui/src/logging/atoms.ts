import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/** What the logging overlay was opened for (or null), updated on every open and while it is open. */
export const loggingOverlayAtom = KladdClient.runtime.atom(
  Stream.unwrap(
    KladdClient.use((client) => Effect.succeed(client("WatchLoggingOverlay", undefined))),
  ),
);

/** Close the logging overlay. */
export const closeLoggingOverlayAtom = KladdClient.mutation("CloseLoggingOverlay");
