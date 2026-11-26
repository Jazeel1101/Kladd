import { Schema } from "effect";
import { Screenshot } from "./Screenshot";
import { Session } from "./Session";

/** An ended session as the expanded view lists it (GLOSSARY: "tidligere økt"). */
export const PastSession = Schema.Struct({
  session: Session,
  /** Oldest first. */
  screenshots: Schema.Array(Screenshot),
  clips: Schema.Number,
});
export type PastSession = typeof PastSession.Type;
