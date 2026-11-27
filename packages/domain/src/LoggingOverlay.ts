import { Schema } from "effect";
import { PillJoin } from "./Placement";
import { WritingTarget } from "./WritingTarget";

/**
 * What the logging overlay shows: the session's summary, or the log's settings, which the
 * pill's gear swaps in.
 */
export const LoggingPanel = Schema.Literals(["summary", "settings"]);
export type LoggingPanel = typeof LoggingPanel.Type;

/** The logging overlay as the pill and the overlay's own UI see it. */
export const LoggingOverlayState = Schema.Struct({
  open: Schema.Boolean,
  panel: LoggingPanel,
  /** Where the user writes, as the app adapter reports it; followed while the overlay is open. */
  target: WritingTarget,
  /** Where the overlay grows out of the pill; null while the pill moves or before it has rested. */
  join: Schema.NullOr(PillJoin),
});
export type LoggingOverlayState = typeof LoggingOverlayState.Type;

export const closedLoggingOverlay: LoggingOverlayState = {
  open: false,
  panel: "summary",
  target: { app: null, document: null },
  join: null,
};
