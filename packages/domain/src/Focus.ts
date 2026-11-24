import { Schema } from "effect";
import { Rect } from "./Placement";

/** The app in front. */
export const FrontApp = Schema.Struct({
  bundleId: Schema.String,
  name: Schema.String,
});
export type FrontApp = typeof FrontApp.Type;

/**
 * A selected row in one of the focused window's lists, such as the current page in a sidebar
 * (GLOSSARY: "markert rad").
 */
export const SelectedItem = Schema.Struct({
  /** AXIdentifier of the row's view, when the app sets one. Unlike `text`, it doesn't change with the UI language. */
  id: Schema.NullOr(Schema.String),
  /** The row's first text, such as a page title. */
  text: Schema.NullOr(Schema.String),
});
export type SelectedItem = typeof SelectedItem.Type;

/**
 * Where the user is at one moment (GLOSSARY: "fokus"). Every field can be null or empty: apps
 * differ in what they report, and without Accessibility permission nothing is known.
 * See docs/internals/overlay-placement.md.
 */
export const FocusSnapshot = Schema.Struct({
  app: Schema.NullOr(FrontApp),
  /** Frame of the app's focused window. */
  window: Schema.NullOr(Rect),
  /** Title of the focused window: often the document or page name. */
  title: Schema.NullOr(Schema.String),
  /** Frame of the focused UI element, such as a text field. */
  element: Schema.NullOr(Rect),
  /** The text cursor. Electron/Chromium apps usually don't report it. */
  caret: Schema.NullOr(Rect),
  /** Selected rows of the window's lists, front to back of the AX tree. Empty when unknown. */
  selection: Schema.Array(SelectedItem),
});
export type FocusSnapshot = typeof FocusSnapshot.Type;

export const emptyFocus: FocusSnapshot = {
  app: null,
  window: null,
  title: null,
  element: null,
  caret: null,
  selection: [],
};

/** Whether the OS lets Kladd read other apps' windows and text fields (GLOSSARY: "tilgjengelighetstilgang"). */
export const AccessibilityPermission = Schema.Literals(["granted", "denied"]);
export type AccessibilityPermission = typeof AccessibilityPermission.Type;

/** Reading focus broke: a missing helper, or output it could not parse. Not a missing permission. */
export class FocusTrackingFailed extends Schema.TaggedError<
  FocusTrackingFailed,
  { readonly brand: unique symbol }
>()("FocusTrackingFailed", { reason: Schema.String }) {}
