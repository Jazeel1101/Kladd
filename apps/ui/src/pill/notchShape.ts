/**
 * The notch's outline: a pill of liquid that the screen edge pulls in.
 *
 * Drawn as if the wall were on the left (x = 0) and the pill a column; RecordingPill turns it to
 * face the right, top or bottom edge (where it is a row). Two
 * subpaths with the same fill, so where they overlap they read as one shape:
 * - the wall: nothing when the pill is far, a bulge as it nears, then a neck that widens into the
 *   docked flare, an inverted border radius out of the wall.
 * - the pill: a rounded rectangle whose side facing the wall bulges toward it before they touch,
 *   and whose corners on that side square off as it docks.
 * Every shape has the same commands, so CSS can transition `d` between them.
 */

/** The pill itself, without anything the wall adds. */
export const pill = { width: 46, height: 130, radius: 20 };
/** The gap at which wall and pill touch. */
const contactGap = 26;
/** Radius of the inverted border radius where the docked notch meets the wall. */
const fillet = 12;
/** The docked notch's top and bottom edges tilt this much toward the middle. */
const tilt = (12 * Math.PI) / 180;
/** Room around the shape for its shadow. */
const shadowPad = 14;
/** How far the docked flare reaches past the pill's top and bottom along the wall. */
export const flare = fillet + (pill.width - pill.radius) * Math.tan(tilt);

/**
 * The SVG canvas, equal to the pill window's size (apps/desktop/src/main/windows.ts). Square, so
 * column and row both fit without resizing the window, and wide enough for the tray to slide out
 * with a screenshot beside the pill (src/pill/intake.ts).
 */
const size = 340;
export const canvas = { width: size, height: size };
/** How far from a wall its pull starts: the wall's snap zone. Room for the docked notch's flare. */
export const attractRange = (Math.ceil(pill.height + 2 * (flare + shadowPad)) - pill.width) / 2;
/**
 * Where the pill sits in the canvas while it floats, centred. Also how far from a wall the window
 * meets it, so the pill starts moving inside the window there.
 */
export const inset = (size - pill.width) / 2;
/** The pill's top in the canvas when the window isn't held in by the screen's top or bottom. */
const restTop = (canvas.height - pill.height) / 2;

/** Bézier handle length for a quarter circle, as a fraction of its radius. */
const kappa = 0.5523;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const n = (value: number) => Math.round(value * 100) / 100;

interface Drop {
  /** Distance from the wall to the pill. Negative squishes the pill against the wall. */
  readonly gap: number;
  /** The pill's width. */
  readonly reach?: number;
  /** The pill's top in the canvas. */
  readonly top?: number;
  /**
   * The gap the liquid is shaped for, when it differs from where the pill is: larger while the pull
   * ramps in, or while a pill that left the wall relaxes. Defaults to `gap`.
   */
  readonly shapeGap?: number;
  /** Whether the pill's side bulges toward the wall. Off once it has left the wall. */
  readonly lean?: boolean;
}

/** The wall's liquid and the pill as separate subpaths, so they can be drawn apart. */
export const dropParts = ({
  gap,
  reach = pill.width,
  top = restTop,
  shapeGap = gap,
  lean = true,
}: Drop): { readonly wall: string; readonly body: string } => {
  const k = kappa;
  const r = pill.radius;
  const width = reach + Math.min(gap, 0) * 0.8;
  const x0 = clamp(gap, 0, inset);
  const mid = top + pill.height / 2;
  const flip = (y: number) => 2 * mid - y;

  // The wall spans mid ± wallHalf and curves out to `tip`, arriving heading `dir`. `wallHandle`
  // and `tipHandle` set how long the curve hugs the wall and how it meets the pill.
  let wallHalf: number;
  let tip: { x: number; y: number };
  let dir: { x: number; y: number };
  let wallHandle: number;
  let tipHandle: number;
  // The pill's corner radius on the wall side, its bulge toward the wall, and how docked it is.
  let leftRadius = r;
  let bulge: number;
  let docked = 0;

  if (shapeGap >= contactGap) {
    // Nearing: the wall bulges out and the pill leans in, until they touch at contactGap.
    const t = smoothstep(attractRange, contactGap, shapeGap) ** 2;
    wallHalf = lerp(12, 28, t);
    tip = { x: t * contactGap * 0.55, y: mid };
    dir = { x: 0, y: 1 };
    wallHandle = tipHandle = wallHalf * 0.5;
    bulge = t * contactGap * 0.45;
  } else {
    // Touching: an hourglass neck joins wall and pill and thickens up the pill's side, then the
    // join slides round the pill's corner onto its top edge as the pill docks into the flare.
    const c = 1 - Math.max(shapeGap, 0) / contactGap;
    const widen = smoothstep(0, 0.5, c);
    docked = smoothstep(0.5, 1, c);
    bulge = contactGap * 0.45 * (1 - smoothstep(0, 0.2, c));
    leftRadius = r * (1 - docked);

    const edgeRun = width - r - leftRadius;
    const rise = docked * edgeRun * Math.tan(tilt);
    const edgeLength = Math.hypot(edgeRun, rise) || 1;
    const edge = { x: edgeRun / edgeLength, y: rise / edgeLength };
    const sideTop = top - rise + leftRadius;

    // Up the side while the neck widens; round the corner and along the edge while docking.
    const round = smoothstep(0, 0.7, docked);
    const theta = (round * Math.PI) / 2;
    const slide = docked ** 2 * fillet;
    const join = lerp(18, mid - sideTop, widen);
    tip =
      docked === 0
        ? { x: x0, y: mid - join }
        : {
            x: x0 + leftRadius - leftRadius * Math.cos(theta) + slide * edge.x,
            y: sideTop - leftRadius * Math.sin(theta) + slide * edge.y,
          };
    dir = {
      x: lerp(Math.sin(theta), edge.x, round),
      y: lerp(-Math.cos(theta), edge.y, round),
    };

    // A symmetric hourglass while it is a neck: the wall's foot level with the join, the curve
    // dipping to near the middle halfway. Docking raises the foot one fillet above the join.
    const foot = lerp(2, fillet, round);
    wallHalf = mid - (tip.y - foot);
    const waistY = tip.y + lerp(join - 1, 3, widen) * (1 - round);
    const handles = (8 / 3) * (waistY - (mid - wallHalf + tip.y) / 2);
    const neckWallHandle = clamp(handles * 0.3, 0, wallHalf);
    const neckTipHandle = clamp(handles - neckWallHandle, 0, mid - tip.y);
    wallHandle = lerp(neckWallHandle, fillet * k, docked);
    tipHandle = lerp(neckTipHandle, fillet * k, docked);
  }

  if (!lean) bulge = 0;

  const ux = dir.x;
  const uy = dir.y;
  const wallTop = mid - wallHalf;
  const wall = [
    `M0 ${n(wallTop)}`,
    `C0 ${n(wallTop + wallHandle)} ${n(tip.x - tipHandle * ux)} ${n(tip.y - tipHandle * uy)} ${n(tip.x)} ${n(tip.y)}`,
    `L${n(tip.x)} ${n(flip(tip.y))}`,
    `C${n(tip.x - tipHandle * ux)} ${n(flip(tip.y - tipHandle * uy))} 0 ${n(flip(wallTop + wallHandle))} 0 ${n(flip(wallTop))}`,
    "Z",
  ];

  // The pill, clockwise like the wall so the two fill as one.
  const rise = docked * (width - r - leftRadius) * Math.tan(tilt);
  const topLeft = { x: x0 + leftRadius, y: top - rise };
  const topRight = { x: x0 + width - r, y: top };
  const run = Math.hypot(topRight.x - topLeft.x, rise) || 1;
  const dx = (topRight.x - topLeft.x) / run;
  const dy = rise / run;
  const right = x0 + width;
  const sideTop = topLeft.y + leftRadius;
  const sideHandle = (mid - sideTop) * 0.5;
  const body = [
    `M${n(topLeft.x)} ${n(topLeft.y)}`,
    `L${n(topRight.x)} ${n(topRight.y)}`,
    `C${n(topRight.x + r * k * dx)} ${n(topRight.y + r * k * dy)} ${n(right)} ${n(top + r - r * k)} ${n(right)} ${n(top + r)}`,
    `L${n(right)} ${n(flip(top + r))}`,
    `C${n(right)} ${n(flip(top + r - r * k))} ${n(topRight.x + r * k * dx)} ${n(flip(topRight.y + r * k * dy))} ${n(topRight.x)} ${n(flip(topRight.y))}`,
    `L${n(topLeft.x)} ${n(flip(topLeft.y))}`,
    `C${n(topLeft.x - leftRadius * k * dx)} ${n(flip(topLeft.y - leftRadius * k * dy))} ${n(x0)} ${n(flip(sideTop - leftRadius * k))} ${n(x0)} ${n(flip(sideTop))}`,
    `C${n(x0)} ${n(flip(sideTop + sideHandle))} ${n(x0 - bulge)} ${n(mid + sideHandle)} ${n(x0 - bulge)} ${n(mid)}`,
    `C${n(x0 - bulge)} ${n(mid - sideHandle)} ${n(x0)} ${n(sideTop + sideHandle)} ${n(x0)} ${n(sideTop)}`,
    `C${n(x0)} ${n(sideTop - leftRadius * k)} ${n(topLeft.x - leftRadius * k * dx)} ${n(topLeft.y - leftRadius * k * dy)} ${n(topLeft.x)} ${n(topLeft.y)}`,
    "Z",
  ];

  return { wall: wall.join(" "), body: body.join(" ") };
};

/** The whole outline, wall and pill as one shape. */
export const dropPath = (drop: Drop): string => {
  const { wall, body } = dropParts(drop);
  return `${wall} ${body}`;
};
