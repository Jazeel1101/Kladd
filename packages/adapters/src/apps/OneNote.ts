import { makeAppAdapter, type FocusSnapshot, type Rect } from "@kladd/domain";

/** The title bar and ribbon above the page canvas. */
const RIBBON = 148;
/** The page canvas's vertical scroll bar, inside its frame. */
const SCROLL_BAR = 20;

/**
 * The page canvas: the focused element when it reaches the window's right edge, as only the canvas
 * does. After a click in the section or page list, that list is focused instead, so the canvas is
 * taken as the window below the ribbon, which has the same top-right corner.
 */
const canvas = ({ element, window }: FocusSnapshot): Rect | null => {
  const reachesRight = (rect: Rect, outer: Rect) =>
    rect.x + rect.width >= outer.x + outer.width - 1;
  if (element !== null && (window === null || reachesRight(element, window))) return element;
  if (window === null) return null;
  return { ...window, y: window.y + RIBBON, height: Math.max(0, window.height - RIBBON) };
};

/**
 * Microsoft OneNote. The page canvas never reports a caret, so the overlay sits inside the canvas's
 * top-right corner: beside it would cover the section and page lists. The window title is the
 * notebook, so the document is the selected row in the page list.
 */
export const OneNote = makeAppAdapter({
  id: "onenote",
  bundleIds: ["com.microsoft.onenote.mac"],
  placement: "inside",
  anchor: (focus) => {
    const page = canvas(focus);
    return page === null ? null : { ...page, width: Math.max(0, page.width - SCROLL_BAR) };
  },
  target: (focus) => ({
    app: focus.app?.name ?? null,
    document: focus.selection.find((item) => item.id === "ONMUXPageItemView")?.text ?? null,
  }),
});
