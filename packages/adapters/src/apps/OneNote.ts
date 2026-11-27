import { makeAppAdapter } from "@kladd/domain";

/**
 * Microsoft OneNote. The window title is the notebook, so the document is the selected row in the
 * page list.
 */
export const OneNote = makeAppAdapter({
  id: "onenote",
  bundleIds: ["com.microsoft.onenote.mac"],
  target: (focus) => ({
    app: focus.app?.name ?? null,
    document: focus.selection.find((item) => item.id === "ONMUXPageItemView")?.text ?? null,
  }),
});
