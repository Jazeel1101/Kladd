import type { Rect } from "@kladd/domain";
import type { NotchFrame, Wall } from "./notchPlacement";
import { attractRange, canvas, dropPath, pill } from "./notchShape";

/**
 * The intake: the pill opens away from its wall to take in a ⌃⇧C screenshot, which lands in its
 * slot, then closes over it. Drawn against a left wall like notchShape.ts; `toWindow` turns it to
 * face the pill's wall.
 */

/** How far across the window the open pill reaches: as far as its shadow still fits. */
const openEdge = canvas.width - 22;
/** Room between the slot and the open pill's edges. */
const pad = 8;

/** Where the open pill starts and ends across its wall. Docked it grows away from the wall; floating, both ways. */
const openSpan = (docked: boolean) => ({
  from: docked ? 0 : canvas.width - openEdge,
  to: openEdge,
});

/** The open pill's outline, for the `.notch-drop` shape. */
export const openPath = (docked: boolean, along: number): string => {
  const { from, to } = openSpan(docked);
  // Floating, the wall stays shaped for a pill out of reach, so it draws nothing.
  return dropPath({ gap: from, reach: to - from, top: along, shapeGap: docked ? 0 : attractRange });
};

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
 * Where a screenshot lands in the open pill, in screen points. Docked, the buttons keep the strip
 * by the wall and the slot takes the rest; floating, the slot spans the pill and covers them.
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
