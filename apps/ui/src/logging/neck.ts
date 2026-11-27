import { overlayMargin, type Edge, type PillJoin, type Size } from "@kladd/domain";
import { pill } from "../pill/notchShape";

/**
 * The neck: where the logging overlay's panel and the pill's notch become one shape. The overlay's
 * window lies under the pill's, reaching over the notch by its margin, so it draws a strip under
 * the notch's side that flares into the panel with inverted corners. The notch hides the strip; the
 * flares show, and so does the strip wherever the notch's own corners round away from it. Coordinates
 * are the overlay window's, in points.
 */

/** As round as the notch's corners, so the strip under the notch covers them. */
const neckRadius = pill.radius;
/** The panel's corner radius. */
export const panelRadius = 22;

/** Turns a shape drawn with the pill on the left (the along axis down) to face `side`. */
const faceSide = (side: Edge, window: Size): string => {
  switch (side) {
    case "left":
      return "matrix(1 0 0 1 0 0)";
    case "right":
      return `matrix(-1 0 0 1 ${window.width} 0)`;
    case "top":
      return "matrix(0 1 1 0 0 0)";
    case "bottom":
      return `matrix(0 -1 1 0 0 ${window.height})`;
  }
};

/** The neck's outline, and the transform that puts it on the join's side. */
export const neck = (
  join: PillJoin,
  window: Size,
): { readonly d: string; readonly transform: string } => {
  const m = overlayMargin;
  const r = neckRadius;
  const { start: s, end: e } = join;
  // Reaches 2 points into the panel, so no hairline shows between the two.
  const d = [
    `M${m + 2} ${s - r}`,
    `L${m} ${s - r}`,
    `A${r} ${r} 0 0 1 ${m - r} ${s}`,
    `L${m - r} ${e}`,
    `A${r} ${r} 0 0 1 ${m} ${e + r}`,
    `L${m + 2} ${e + r}`,
    "Z",
  ].join(" ");
  return { d, transform: faceSide(join.side, window) };
};

/**
 * Where the panel grows from, as a `transform-origin` on it: the middle of the notch's span, on the
 * join's side. `panel` is the panel's size; the join is in the window, `overlayMargin` around it.
 */
export const growOrigin = (join: PillJoin, panel: Size): string => {
  const middle = (join.start + join.end) / 2 - overlayMargin;
  switch (join.side) {
    case "left":
      return `0px ${middle}px`;
    case "right":
      return `${panel.width}px ${middle}px`;
    case "top":
      return `${middle}px 0px`;
    case "bottom":
      return `${middle}px ${panel.height}px`;
  }
};
