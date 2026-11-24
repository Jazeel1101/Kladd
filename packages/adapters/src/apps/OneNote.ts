import { makeAppAdapter } from "@kladd/domain";

/**
 * Microsoft OneNote. The focused element is the page canvas, which never reports a caret, so the
 * overlay sits inside the canvas's top-right corner: beside it would cover the section and page
 * lists. The canvas frame includes its 20pt vertical scroll bar, which the anchor leaves out. The
 * window title is the notebook, so the document is the selected row in the page list.
 */
export const OneNote = makeAppAdapter({
  id: "onenote",
  bundleIds: ["com.microsoft.onenote.mac"],
  placement: "inside",
  anchor: (focus) =>
    focus.element === null
      ? focus.window
      : { ...focus.element, width: Math.max(0, focus.element.width - 20) },
  target: (focus) => ({
    app: focus.app?.name ?? null,
    document: focus.selection.find((item) => item.id === "ONMUXPageItemView")?.text ?? null,
  }),
});
