import type { NotchFrame, Point, Wall } from "./notchPlacement";
import { attractRange, dropParts, pill } from "./notchShape";

/**
 * The liquid that comes out of a wall belongs to the wall, not the pill. While the pill nears a wall
 * or sits on it, the wall reaches for it (attached). Once the pill is pulled away, the wall lets go:
 * its liquid stays where it was and sinks back out of the screen (the residue) while the pill
 * relaxes into a plain pill (leaving). Moving back toward the wall attaches it again.
 * Pure: the drag hook steps it on every frame and reads a view of it to draw.
 */

/** How long the pull takes to build up again after the pill turns back toward the wall. */
const rampIn = 160;
/** How long the wall's liquid takes to sink back, and the pill to relax. */
const letGo = 220;
/** How far the pill must move against its course before it counts as turning back or away. */
const reverse = 6;

/** The wall's liquid as last drawn, in its own (left-wall) coordinates. */
interface WallShape {
  readonly wall: Wall;
  readonly path: string;
  /** Its middle along the wall, in the window. */
  readonly mid: number;
  /** Where the window was, to keep the liquid in place on screen while the window moves. */
  readonly window: Point;
}

export interface Liquid {
  readonly mode: "attached" | "leaving";
  /** When the mode began: the pull ramps in, or the pill relaxes, from here. */
  readonly since: number;
  /** The gap the pill was shaped for when it began leaving. */
  readonly from: number;
  /** The nearest (attached) or farthest (leaving) the pill has been since, to see it turn. */
  readonly extreme: number;
  /** The wall whose zone the pill is in. */
  readonly wall: Wall | null;
  /** The wall's liquid on the last frame, while attached. */
  readonly shape: WallShape | null;
  /** Liquid a wall let go of, sinking back since `since`. */
  readonly residue: (WallShape & { readonly since: number }) | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const progress = (since: number, now: number, duration: number) =>
  clamp((now - since) / duration, 0, 1);

/** Docked on `wall`, fully pulled. */
export const dockedLiquid = (wall: Wall): Liquid => ({
  mode: "attached",
  since: -Infinity,
  from: attractRange,
  extreme: 0,
  wall,
  shape: null,
  residue: null,
});

/** The gap to shape for; a wall that pulls less (in a corner) shapes as if the pill were farther. */
const shapeGap = (liquid: Liquid, frame: NotchFrame, now: number) =>
  liquid.mode === "attached"
    ? lerp(attractRange, frame.gap, easeOut(progress(liquid.since, now, rampIn)) * frame.pull)
    : lerp(liquid.from, attractRange, easeOut(progress(liquid.since, now, letGo)));

const live = (residue: Liquid["residue"], now: number) =>
  residue !== null && progress(residue.since, now, letGo) < 1 ? residue : null;

const wallShape = (liquid: Liquid, frame: NotchFrame, now: number): WallShape => ({
  wall: frame.drawWall,
  path: dropParts({ gap: frame.gap, top: frame.along, shapeGap: shapeGap(liquid, frame, now) })
    .wall,
  mid: frame.along + pill.height / 2,
  window: frame.window,
});

/** The wall lets go of the pill: what it last reached out with starts sinking back. */
const leave = (liquid: Liquid, now: number) =>
  liquid.shape === null ? live(liquid.residue, now) : { ...liquid.shape, since: now };

/** Advances the liquid to `frame`. `holding` is true while the user drags the pill. */
export const stepLiquid = (
  liquid: Liquid,
  frame: NotchFrame,
  holding: boolean,
  now: number,
): Liquid => {
  if (frame.wall !== liquid.wall) {
    // Into a new zone, or out of all of them: any wall that was reaching lets go.
    const residue = liquid.mode === "attached" ? leave(liquid, now) : live(liquid.residue, now);
    const next = { ...dockedLiquid(frame.wall ?? "left"), wall: frame.wall, extreme: frame.gap };
    return { ...next, residue, shape: frame.wall === null ? null : wallShape(next, frame, now) };
  }
  if (liquid.mode === "attached") {
    if (holding && frame.gap > liquid.extreme + reverse) {
      return {
        ...liquid,
        mode: "leaving",
        since: now,
        from: shapeGap(liquid, frame, now),
        extreme: frame.gap,
        shape: null,
        residue: leave(liquid, now),
      };
    }
    return {
      ...liquid,
      extreme: Math.min(liquid.extreme, frame.gap),
      shape: frame.wall === null ? null : wallShape(liquid, frame, now),
      residue: live(liquid.residue, now),
    };
  }
  if (frame.gap < liquid.extreme - reverse) {
    const attached: Liquid = { ...liquid, mode: "attached", since: now, extreme: frame.gap };
    return { ...attached, shape: wallShape(attached, frame, now) };
  }
  return {
    ...liquid,
    extreme: Math.max(liquid.extreme, frame.gap),
    residue: live(liquid.residue, now),
  };
};

/** Let go of in a zone: the wall reaches for the pill again as it springs onto it. */
export const releaseLiquid = (liquid: Liquid, now: number): Liquid =>
  liquid.mode === "leaving" ? { ...liquid, mode: "attached", since: now } : liquid;

/** What to draw now. */
export interface LiquidView {
  /** The gap to shape the pill (and the attached wall) for. */
  readonly shapeGap: number;
  /** Whether the wall is attached: draw its liquid and the pill leaning toward it. */
  readonly attached: boolean;
  /** Liquid a wall let go of, scaled down toward the wall as it sinks back. */
  readonly residue: {
    readonly wall: Wall;
    readonly path: string;
    readonly mid: number;
    /** From where the window is now to where it was, so the liquid stays put on screen. */
    readonly offset: Point;
    readonly scale: number;
  } | null;
  /** Whether anything still moves on its own, so the view must be redrawn next frame. */
  readonly animating: boolean;
}

export const viewLiquid = (liquid: Liquid, frame: NotchFrame, now: number): LiquidView => {
  const residue = live(liquid.residue, now);
  const duration = liquid.mode === "attached" ? rampIn : letGo;
  return {
    shapeGap: shapeGap(liquid, frame, now),
    attached: liquid.mode === "attached",
    residue:
      residue === null
        ? null
        : {
            wall: residue.wall,
            path: residue.path,
            mid: residue.mid,
            offset: { x: residue.window.x - frame.window.x, y: residue.window.y - frame.window.y },
            scale: 1 - easeOut(progress(residue.since, now, letGo)),
          },
    animating: residue !== null || progress(liquid.since, now, duration) < 1,
  };
};
