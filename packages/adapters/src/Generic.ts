import { makeAppAdapter } from "@kladd/domain";

/**
 * Fallback for apps without an adapter: anchors to the text cursor, else the focused element, else
 * the window. Its writing target is the default: app name and window title.
 */
export const Generic = makeAppAdapter({
  id: "generic",
  bundleIds: [],
  anchor: (focus) => focus.caret ?? focus.element ?? focus.window,
});
