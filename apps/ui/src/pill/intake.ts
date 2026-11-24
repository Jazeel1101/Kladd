import type { Rect } from "@kladd/domain";
import type { NotchFrame, Wall } from "./notchPlacement";
import { attractRange, canvas, pill } from "./notchShape";

/**
 * The intake: a tray slides out of the pill's flat side to take in a ⌃⇧C screenshot, which lands
 * in its slot, then slides back over it. The pill keeps its shape: the tray is a flat rounded
 * rectangle drawn with it, hidden in the pill's rounded end when shut. Drawn against a left wall
 * like notchShape.ts; `toWindow` turns it to face the pill's wall.
 */

/** How far across the window the open tray reaches: as far as its shadow still fits. */
const openEdge = canvas.width - 22;
/** Room between the slot and the open tray's edges. */
const pad = 8;

/**
 * Where the open tray starts and ends across its wall. Docked it slides out of the pill's flat side,
 * away from the wall; floating, it grows out of the whole pill both ways.
 */
const openSpan = (docked: boolean) => ({
  from: docked ? pill.width - 2 * pill.radius : canvas.width - openEdge,
  to: openEdge,
});

/** Where the shut tray sits: the pill's flat rounded end docked, the whole pill floating. */
const shutSpan = (docked: boolean) => {
  const right = (docked ? 0 : attractRange) + pill.width;
  return { from: docked ? right - 2 * pill.radius : right - pill.width, to: right };
};

const roundedRect = ({ from, to }: { from: number; to: number }, top: number) => {
  const r = pill.radius;
  const bottom = top + pill.height;
  return [
    `M${from + r} ${top}`,
    `L${to - r} ${top}`,
    `A${r} ${r} 0 0 1 ${to} ${top + r}`,
    `L${to} ${bottom - r}`,
    `A${r} ${r} 0 0 1 ${to - r} ${bottom}`,
    `L${from + r} ${bottom}`,
    `A${r} ${r} 0 0 1 ${from} ${bottom - r}`,
    `L${from} ${top + r}`,
    `A${r} ${r} 0 0 1 ${from + r} ${top}`,
    "Z",
  ].join(" ");
};

/**
 * The tray's outline, open or shut, for the `.notch-tray` shape. Both have the same commands, so
 * CSS can transition between them.
 */
export const trayPath = (docked: boolean, along: number, open: boolean): string =>
  roundedRect(open ? openSpan(docked) : shutSpan(docked), along);

/** A rect drawn against a left wall, turned to face `wall` in the window (see `faceWall`). */
const toWindow = (wall: Wall, r: Rect): Rect => {
  const turned = { x: r.y, width: r.height, height: r.width };
  switch (wall) {
    case "left":
      return r;
    case "right":
      return { ...r, x: canvas.width - r.x - r.width };
    case "top":
      return { ...turned, y: r.x };
    case "bottom":
      return { ...turned, y: canvas.height - r.x - r.width };
  }
};

/**
 * Where a screenshot in the tray is gone once the tray has shut, in the window: past the pill's
 * flat side docked, the pill's middle floating. The screenshot stays put and is cut off toward
 * this as the tray shuts over it.
 */
export const goneAt = (frame: NotchFrame): Rect => {
  const { from, to } = shutSpan(frame.wall !== null);
  const middle = (from + to) / 2;
  const span = frame.wall !== null ? { from, to } : { from: middle, to: middle };
  return toWindow(frame.drawWall, {
    x: span.from,
    y: frame.along,
    width: span.to - span.from,
    height: pill.height,
  });
};

/**
 * Where a screenshot lands in the open tray, in screen points. Docked, the buttons keep the strip
 * by the wall and the slot takes the rest; floating, the slot spans the tray and covers them.
 */
export const screenshotSlot = (frame: NotchFrame): Rect => {
  const docked = frame.wall !== null;
  const { from, to } = openSpan(docked);
  const left = docked ? pill.width : from + pad;
  const inWindow = toWindow(frame.drawWall, {
    x: left,
    y: frame.along + pad,
    width: to - pad - left,
    height: pill.height - 2 * pad,
  });
  return { ...inWindow, x: inWindow.x + frame.window.x, y: inWindow.y + frame.window.y };
};
