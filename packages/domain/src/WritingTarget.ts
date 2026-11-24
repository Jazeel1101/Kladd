import { Schema } from "effect";

/**
 * What the user is writing in, as the logging overlay shows it (GLOSSARY: "skrivested").
 * An app adapter derives it from a FocusSnapshot; each field is null when unknown.
 */
export const WritingTarget = Schema.Struct({
  /** The app's name, such as "Microsoft OneNote". */
  app: Schema.NullOr(Schema.String),
  /** The document, page or note, such as a OneNote page title. */
  document: Schema.NullOr(Schema.String),
});
export type WritingTarget = typeof WritingTarget.Type;

/** What the logging overlay was opened for: sent to its UI on every open. */
export const LoggingOverlayInfo = Schema.Struct({
  target: WritingTarget,
  /** Id of the adapter that placed it. */
  adapter: Schema.String,
  /** False when it sits at the no-anchor position (nothing to place it next to). */
  anchored: Schema.Boolean,
});
export type LoggingOverlayInfo = typeof LoggingOverlayInfo.Type;
