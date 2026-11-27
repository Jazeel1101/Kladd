import { Schema } from "effect";
import { sessionFiles } from "./SessionFolder";

/** The summary agent could not write `summary.md`: no agent installed, not logged in, or it failed. */
export class SummaryFailed extends Schema.TaggedError<
  SummaryFailed,
  { readonly brand: unique symbol }
>()("SummaryFailed", { reason: Schema.String }) {}

/** The summary agent's instructions, for any agent: what to read and what to write. */
export const summaryInstructions = [
  "You summarize one work session of a vocational student (16–19) for their work log.",
  `The current folder is the session folder. Start with \`${sessionFiles.overview}\`: it says what the folder holds and how to read it. Other sessions are in the folder above; read them only to see what came before.`,
  "Look at every screenshot the student took and read every clip's transcript. To see a moment of a clip's video, call `frame_at` with the clip and a time, then Read the image it returns.",
  `Then write \`${sessionFiles.summary}\` in this folder, and nothing else: what the student worked on, in order, with the times (session \`t\`) and the files you saw it in, so they can write their log from it. Stick to what the folder shows; do not guess.`,
  "Write in the language the student speaks in the clips, or else the language on their screen. If that is unclear, write Norwegian bokmål.",
].join("\n\n");

/**
 * The open session's summary (GLOSSARY: "oppsummering") as the logging overlay shows it: being
 * written, written with the text of `summary.md`, or failed, so the student logs without one.
 */
export const SummaryStatus = Schema.Union([
  Schema.TaggedStruct("Writing", {}),
  Schema.TaggedStruct("Written", { text: Schema.String }),
  Schema.TaggedStruct("Failed", {}),
]);
export type SummaryStatus = typeof SummaryStatus.Type;
