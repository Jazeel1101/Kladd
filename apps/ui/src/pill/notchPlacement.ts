import { attractRange, canvas, flare, inset, pill } from "./notchShape";

/**
 * Where the notch is on screen and what that means for drawing it. Pure: the drag hook feeds it
 * pointer positions, and it answers which wall pulls the pill, where the window goes and where the
 * pill sits inside it. Coordinates are screen points unless a name says "window".
 */

/** A screen edge. The pill docks on all but the top, which belongs to the menu bar and camera. */
export type Wall = "left" | "right" | "top" | "bottom";
/** A column on the left and right walls, a row on the bottom. Floating keeps the last one. */
export type Orientation = "column" | "row";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Area {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The walls with a snap zone. */
const docking: ReadonlyArray<Wall> = ["left", "right", "bottom"];
/** How far either side of a corner's diagonal the pill turns from one wall's layout to the other's. */
const cornerBand = 24;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

export const orientationOf = (wall: Wall): Orientation =>
  wall === "left" || wall === "right" ? "column" : "row";

const boxSize = (orientation: Orientation) =>
  orientation === "column"
    ? { width: pill.width, height: pill.height }
    : { width: pill.height, height: pill.width };

/** Distance from `wall` to a pill centred at `center`, shaped for that wall. */
const gapTo = (wall: Wall, center: Point, area: Area): number => {
  const { width, height } = boxSize(orientationOf(wall));
  switch (wall) {
    case "left":
      return center.x - width / 2 - area.left;
    case "right":
      return area.right - (center.x + width / 2);
    case "top":
      return center.y - height / 2 - area.top;
    case "bottom":
      return area.bottom - (center.y + height / 2);
  }
};

/**
 * The wall whose snap zone the pill is in, or null when it floats. A wall's zone is everywhere it
 * visibly pulls the pill, so whatever looks attracted snaps on release and nothing else does.
 * In a corner the zones overlap and the nearer wall wins: they swap on the corner's diagonal,
 * where `cornerTilt` has the pill half turned and neither wall pulling.
 */
export const zoneAt = (center: Point, area: Area): Wall | null => {
  let nearest: Wall | null = null;
  let nearestGap = attractRange;
  for (const wall of docking) {
    const gap = gapTo(wall, center, area);
    if (gap < nearestGap) {
      nearest = wall;
      nearestGap = gap;
    }
  }
  return nearest;
};

/** The docking walls that meet `wall` in a corner. */
const across: Record<Wall, ReadonlyArray<Wall>> = {
  left: ["bottom"],
  right: ["bottom"],
  top: [],
  bottom: ["left", "right"],
};

/** Which way a wall faces into the screen, along its axis. */
const inward: Record<Wall, number> = { left: 1, right: -1, top: 1, bottom: -1 };

/**
 * How far a pill in a corner has turned toward the other wall's layout, in degrees for a column: 0
 * while only `wall` pulls, ±45 on the corner's diagonal, where both pull equally and the walls swap.
 * It turns the way it rolls round the corner, so on the diagonal it lies across the corner. Follows
 * the position, so crossing the diagonal back and forth turns the pill back and forth with it.
 */
const cornerTilt = (wall: Wall, center: Point, area: Area): number => {
  const gap = gapTo(wall, center, area);
  let tilt = 0;
  for (const other of across[wall]) {
    const otherGap = gapTo(other, center, area);
    if (otherGap >= attractRange) continue;
    const turn = 0.5 * (1 - smoothstep(0, cornerBand, otherGap - gap));
    if (turn > Math.abs(tilt) / 90) tilt = 90 * turn * inward[wall] * inward[other];
  }
  return tilt;
};

/**
 * Keeps the pill on screen while it is dragged. In a wall's zone it also keeps the docked flare on
 * screen along the wall, so it can dock wherever it is let go. In a corner the pill is turned
 * (`cornerTilt`), so it is kept in by its turned outline and the flare fades with the wall's pull:
 * on the diagonal both layouts are kept equally far from both walls, and meet.
 */
export const clampCenter = (
  center: Point,
  orientation: Orientation,
  wall: Wall | null,
  area: Area,
): Point => {
  const turned = wall === null ? 0 : Math.abs(cornerTilt(wall, center, area));
  const angle = (turned * Math.PI) / 180;
  const r = pill.radius;
  const long = pill.height / 2 - r;
  const short = pill.width / 2 - r;
  const across = short * Math.cos(angle) + long * Math.sin(angle) + r;
  const along =
    long * Math.cos(angle) +
    short * Math.sin(angle) +
    r +
    (wall === null ? 0 : flare * (1 - turned / 45));
  const marginX = orientation === "column" ? across : along;
  const marginY = orientation === "column" ? along : across;
  return {
    x: clamp(center.x, area.left + marginX, area.right - marginX),
    y: clamp(center.y, area.top + marginY, area.bottom - marginY),
  };
};

/** Where a pill let go in `wall`'s zone comes to rest: on the wall, with its flare on screen. */
export const restingCenter = (wall: Wall, center: Point, area: Area): Point => {
  const { width, height } = boxSize(orientationOf(wall));
  const on = centerAtGap(wall, 0, center, area);
  return orientationOf(wall) === "column"
    ? { x: on.x, y: clamp(on.y, area.top + height / 2 + flare, area.bottom - height / 2 - flare) }
    : { x: clamp(on.x, area.left + width / 2 + flare, area.right - width / 2 - flare), y: on.y };
};

/** Where the pill's centre goes to sit `gap` from `wall`, keeping its place along the wall. */
export const centerAtGap = (wall: Wall, gap: number, center: Point, area: Area): Point => {
  const { width, height } = boxSize(orientationOf(wall));
  switch (wall) {
    case "left":
      return { x: area.left + gap + width / 2, y: center.y };
    case "right":
      return { x: area.right - gap - width / 2, y: center.y };
    case "top":
      return { x: center.x, y: area.top + gap + height / 2 };
    case "bottom":
      return { x: center.x, y: area.bottom - gap - height / 2 };
  }
};

/** Everything needed to draw the notch and place its window. */
export interface NotchFrame {
  /** The wall whose zone the pill is in; null while it floats. */
  readonly wall: Wall | null;
  readonly orientation: Orientation;
  /** The wall the shape is drawn against: `wall`, or a stand-in that keeps a floating pill plain. */
  readonly drawWall: Wall;
  /** Distance from `drawWall`. Negative while the pill squishes into the wall. */
  readonly gap: number;
  /**
   * Degrees the pill is turned from its layout, in a corner. A row is a column turned 90°, so the
   * two layouts meet at ±45° on the corner's diagonal, turned opposite ways.
   */
  readonly tilt: number;
  /** How hard `wall` pulls: 1, falling to 0 on a corner's diagonal where the other wall pulls too. */
  readonly pull: number;
  /** The pill's box in the window. */
  readonly box: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  /** Where the pill starts along `drawWall`, in the window: the shape's `top`. */
  readonly along: number;
  /** The window's top-left corner on screen. */
  readonly window: Point;
}

/**
 * The window is centred on the pill, but never leaves the work area: near a wall it stays against
 * it and the pill moves inside it, so the shape can reach the wall.
 */
export const frameAt = (
  center: Point,
  orientation: Orientation,
  wall: Wall | null,
  area: Area,
): NotchFrame => {
  const { width, height } = boxSize(orientation);
  const half = canvas.width / 2;
  const window = {
    x: Math.round(clamp(center.x - half, area.left, area.right - canvas.width)),
    y: Math.round(clamp(center.y - half, area.top, area.bottom - canvas.height)),
  };
  const box = {
    left: center.x - width / 2 - window.x,
    top: center.y - height / 2 - window.y,
    width,
    height,
  };
  const tilt = wall === null ? 0 : cornerTilt(wall, center, area);
  return {
    wall,
    orientation,
    drawWall: wall ?? (orientation === "column" ? "left" : "top"),
    gap: wall === null ? inset : gapTo(wall, center, area),
    tilt: orientation === "column" ? tilt : -tilt,
    pull: 1 - Math.abs(tilt) / 45,
    box,
    along: orientation === "column" ? box.top : box.left,
    window,
  };
};
