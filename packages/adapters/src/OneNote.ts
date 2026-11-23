import { makeAppAdapter } from "@kladd/domain";

/**
 * Microsoft OneNote. Its page editor reports the focused element but often no caret, so this
 * anchors to the element first: the overlay then sits beside the page instead of jumping per line.
 */
export const OneNote = makeAppAdapter({
  id: "onenote",
  bundleIds: ["com.microsoft.onenote.mac"],
  anchor: (focus) => focus.element ?? focus.window,
});
