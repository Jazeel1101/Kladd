import { Schema } from "effect";
import { Rect } from "./Placement";

/** The app in front. */
export const FrontApp = Schema.Struct({
  bundleId: Schema.String,
  name: Schema.String,
});
export type FrontApp = typeof FrontApp.Type;

/**
 * Where the user is at one moment (GLOSSARY: "fokus"). Every field can be null: apps differ in what
 * they report, and without Accessibility permission nothing is known.
 * See docs/internals/overlay-placement.md.
 */
export const FocusSnapshot = Schema.Struct({
  app: Schema.NullOr(FrontApp),
  /** Frame of the app's focused window. */
  window: Schema.NullOr(Rect),
  /** Frame of the focused UI element, such as a text field. */
  element: Schema.NullOr(Rect),
  /** The text cursor. Electron/Chromium apps usually don't report it. */
  caret: Schema.NullOr(Rect),
});
export type FocusSnapshot = typeof FocusSnapshot.Type;

export const emptyFocus: FocusSnapshot = { app: null, window: null, element: null, caret: null };
