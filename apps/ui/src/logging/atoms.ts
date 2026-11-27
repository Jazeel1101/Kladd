import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/** The logging overlay: open or not, its panel, the writing target and its join to the pill. */
export const loggingOverlayAtom = KladdClient.runtime.atom(
  Stream.unwrap(
    KladdClient.use((client) => Effect.succeed(client("WatchLoggingOverlay", undefined))),
  ),
);

/** The ended session's summary: being written, written or failed; null without an ended session. */
export const summaryAtom = KladdClient.runtime.atom(
  Stream.unwrap(KladdClient.use((client) => Effect.succeed(client("WatchSummary", undefined)))),
);

/** Use each with `{ payload: undefined }`. */
export const toggleLoggingOverlayAtom = KladdClient.mutation("ToggleLoggingOverlay");
export const toggleLogSettingsAtom = KladdClient.mutation("ToggleLogSettings");
