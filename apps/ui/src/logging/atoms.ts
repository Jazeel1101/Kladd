import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/** The logging overlay: open or not, its panel, the writing target and its join to the pill. */
export const loggingOverlayAtom = KladdClient.runtime.atom(
  Stream.unwrap(
    KladdClient.use((client) => Effect.succeed(client("WatchLoggingOverlay", undefined))),
  ),
);

/** Use each with `{ payload: undefined }`. */
export const toggleLoggingOverlayAtom = KladdClient.mutation("ToggleLoggingOverlay");
export const toggleLogSettingsAtom = KladdClient.mutation("ToggleLogSettings");
/** Hands keyboard focus back to the app the student writes in. */
export const returnFocusAtom = KladdClient.mutation("ReturnFocus");
