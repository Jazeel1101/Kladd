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
