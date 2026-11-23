import { Schema } from "effect";

/** A screen rectangle in points, origin top-left of the main display (Electron's and AX's coordinates). */
export const Rect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
export type Rect = typeof Rect.Type;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Space between an overlay and the thing it sits next to. */
const GAP = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where an overlay goes next to `anchor` (GLOSSARY: Anchor), inside `screen` (a display's work area).
 * Prefers the right side, top-aligned with the anchor; flips to the left when the right doesn't fit;
 * always stays fully on the screen.
 */
export const placeOverlay = (anchor: Rect, size: Size, screen: Rect): Rect => {
  const right = anchor.x + anchor.width + GAP;
  const left = anchor.x - GAP - size.width;
  const fitsRight = right + size.width <= screen.x + screen.width;
  const fitsLeft = left >= screen.x;
  const x = fitsRight || !fitsLeft ? right : left;
  return {
    x: clamp(x, screen.x, screen.x + screen.width - size.width),
    y: clamp(anchor.y, screen.y, screen.y + screen.height - size.height),
    width: size.width,
    height: size.height,
  };
};

/** Where an overlay goes when there is no anchor: vertically centred at the right edge of the screen. */
export const placeWithoutAnchor = (size: Size, screen: Rect): Rect => ({
  x: screen.x + screen.width - size.width - GAP,
  y: screen.y + Math.round((screen.height - size.height) / 2),
  width: size.width,
  height: size.height,
});
