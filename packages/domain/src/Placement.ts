import { Schema } from "effect";

/** A screen rectangle in points, origin top-left of the main display (Electron's and AX's coordinates). */
export const Rect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
export type Rect = typeof Rect.Type;

/** A screen point, in the same coordinates as Rect. */
export const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });
export type Point = typeof Point.Type;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A side of a rect, or an edge of the screen. */
export const Edge = Schema.Literals(["left", "right", "top", "bottom"]);
export type Edge = typeof Edge.Type;

/**
 * Where the pill's notch rests on screen (GLOSSARY: "pilleplass"), and the wall it is docked on, or
 * null while it floats. The pill sends it whenever it comes to rest.
 */
export const PillDock = Schema.Struct({ notch: Rect, wall: Schema.NullOr(Edge) });
export type PillDock = typeof PillDock.Type;

/**
 * Where an overlay that grows out of the pill meets the notch, in the overlay's window: the side of
 * its panel the pill is on, and the span of that side the notch covers, from the window's top (for
 * `left` and `right`) or left (for `top` and `bottom`). The overlay draws the neck there.
 */
export const PillJoin = Schema.Struct({
  side: Edge,
  start: Schema.Finite,
  end: Schema.Finite,
});
export type PillJoin = typeof PillJoin.Type;

/**
 * Room an overlay that draws its own shadow leaves around its panel, inside its window. The panel's
 * side that joins the pill touches the notch, so the window reaches this far over the notch.
 */
export const overlayMargin = 28;

/** Space between an overlay without a pill to join and the screen's edge. */
const GAP = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The side of the panel the pill is on: the panel grows away from the wall it is docked on. A
 * floating pill grows it toward the side with more room, across its long side, unless only its
 * short side leaves room for the whole panel.
 */
const pillSide = ({ notch, wall }: PillDock, size: Size, screen: Rect): Edge => {
  if (wall !== null) return wall;
  // Room for the panel on each side of the notch, by the side of the panel the pill is then on.
  const room = {
    left: screen.x + screen.width - (notch.x + notch.width) - (size.width - overlayMargin),
    right: notch.x - screen.x - (size.width - overlayMargin),
    top: screen.y + screen.height - (notch.y + notch.height) - (size.height - overlayMargin),
    bottom: notch.y - screen.y - (size.height - overlayMargin),
  };
  const roomier = (a: Edge, b: Edge): Edge => (room[a] >= room[b] ? a : b);
  const long = notch.height >= notch.width ? roomier("left", "right") : roomier("top", "bottom");
  const short = notch.height >= notch.width ? roomier("top", "bottom") : roomier("left", "right");
  return room[long] < 0 && room[short] >= 0 ? short : long;
};

/**
 * Where an overlay window of `size` goes to grow out of the pill's notch, inside `screen` (a
 * display's work area): its panel's side touches the notch's long side facing into the screen, and
 * it is centred on the notch along it, moved only to stay on screen. Also where the notch meets it.
 */
export const placeBesidePill = (
  dock: PillDock,
  size: Size,
  screen: Rect,
): { readonly bounds: Rect; readonly join: PillJoin } => {
  const { notch } = dock;
  const side = pillSide(dock, size, screen);
  const across = side === "left" || side === "right";
  const centre = { x: notch.x + notch.width / 2, y: notch.y + notch.height / 2 };
  const x = Math.round(
    clamp(
      side === "left"
        ? notch.x + notch.width - overlayMargin
        : side === "right"
          ? notch.x - size.width + overlayMargin
          : centre.x - size.width / 2,
      screen.x,
      screen.x + screen.width - size.width,
    ),
  );
  const y = Math.round(
    clamp(
      side === "top"
        ? notch.y + notch.height - overlayMargin
        : side === "bottom"
          ? notch.y - size.height + overlayMargin
          : centre.y - size.height / 2,
      screen.y,
      screen.y + screen.height - size.height,
    ),
  );
  const start = across ? notch.y - y : notch.x - x;
  const length = across ? notch.height : notch.width;
  return {
    bounds: { x, y, width: size.width, height: size.height },
    join: { side, start, end: start + length },
  };
};

/**
 * Where an overlay goes before the pill has said where it rests: vertically centred at the right
 * edge of the screen.
 */
export const placeWithoutPill = (size: Size, screen: Rect): Rect => ({
  x: screen.x + screen.width - size.width - GAP,
  y: screen.y + Math.round((screen.height - size.height) / 2),
  width: size.width,
  height: size.height,
});
