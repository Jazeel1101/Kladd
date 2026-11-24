import type { Rect, ScreenshotSlot } from "@kladd/domain";
import type { NotchFrame, Wall } from "./notchPlacement";
import { canvas, pill } from "./notchShape";

/**
 * The intake: a tray slides out of the pill's flat side to take in a ⌃⇧C screenshot, which lands
 * in it at the tray's full height, then slides back over it. The tray is as long as the screenshot
 * is wide, so it hugs it. The pill keeps its shape: the tray is a flat rounded rectangle drawn with
 * it, hidden in the pill's rounded end when shut. Rects here are in the pill window unless a name
 * says "screen".
 */

/** Room for the tray's shadow, and for its overshoot as it springs open, at the window's edge. */
const edgeRoom = 34;
/** Room between the screenshot and the open tray's edges. */
const pad = 8;

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
 * Where a screenshot can land in the tray, in screen points. Docked, the tray slides out beside the
 * buttons and the screenshot keeps to the pill; floating, it opens both ways from the pill's middle.
 */
export const screenshotSlot = (frame: NotchFrame): ScreenshotSlot => {
  const reach = canvas.width - edgeRoom - pad;
  const from = frame.wall === null ? canvas.width - reach : pill.width;
  const room = toWindow(frame.drawWall, {
    x: from,
    y: frame.along + pad,
    width: reach - from,
    height: pill.height - 2 * pad,
  });
  return {
    room: { ...room, x: room.x + frame.window.x, y: room.y + frame.window.y },
    hug: frame.wall,
  };
};

/**
 * The shut tray: the pill's flat rounded end docked, the whole pill floating. Open, it also covers
 * the screenshot at `landing` with room around it.
 */
export const trayRects = (frame: NotchFrame, landing: Rect) => {
  const { box } = frame;
  const shut =
    frame.wall === null
      ? { x: box.left, y: box.top, width: box.width, height: box.height }
      : toWindow(frame.drawWall, {
          x: pill.width - 2 * pill.radius,
          y: frame.along,
          width: 2 * pill.radius,
          height: pill.height,
        });
  const left = Math.min(shut.x, landing.x - pad);
  const top = Math.min(shut.y, landing.y - pad);
  const right = Math.max(shut.x + shut.width, landing.x + landing.width + pad);
  const bottom = Math.max(shut.y + shut.height, landing.y + landing.height + pad);
  return { shut, open: { x: left, y: top, width: right - left, height: bottom - top } };
};

/**
 * A rect with the pill's rounded corners. Every one has the same commands, so CSS can transition
 * between them.
 */
export const roundedPath = ({ x, y, width, height }: Rect): string => {
  const r = pill.radius;
  return [
    `M${x + r} ${y}`,
    `L${x + width - r} ${y}`,
    `A${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `L${x + width} ${y + height - r}`,
    `A${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `L${x + r} ${y + height}`,
    `A${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `L${x} ${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
};
