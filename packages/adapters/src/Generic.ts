import { makeAppAdapter } from "@kladd/domain";

/** Fallback for apps without an adapter: the text cursor, else the focused element, else the window. */
export const Generic = makeAppAdapter({
  id: "generic",
  bundleIds: [],
  anchor: (focus) => focus.caret ?? focus.element ?? focus.window,
});
