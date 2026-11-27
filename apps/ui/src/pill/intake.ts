import type { Rect, ScreenshotSlot } from "@kladd/domain";
import type { Area, NotchFrame, Wall } from "./notchPlacement";
import { canvas, pill } from "./notchShape";

/**
 * The intake: a tray slides out of the pill's flat side to take in a ⌃⇧C screenshot, which lands
 * in it at the tray's full height, then slides back over it. The tray is as long as the screenshot
 * is wide, so it hugs it. The pill keeps its shape: the tray is a flat rounded rectangle drawn with
 * it, hidden in the pill's rounded end when shut. The same tray opens as the settings panel. Rects
 * here are in the pill window unless a name says "screen".
 */

/** Room for the tray's shadow, and for its overshoot as it springs open, at the window's edge. */
const edgeRoom = 34;
/** Room between the screenshot and the open tray's edges. */
const pad = 8;

/** The pill's box in the window. */
const boxOf = ({ box }: NotchFrame): Rect => ({
  x: box.left,
  y: box.top,
  width: box.width,
  height: box.height,
});

/**
 * The side of the tray the pill is on. Docked, the tray slides out away from the wall; floating, it
 * opens toward whichever side of the pill has more of the screen.
 */
const pillSide = (frame: NotchFrame, area: Area): Wall => {
  if (frame.wall !== null) return frame.wall;
  const box = boxOf(frame);
  const left = frame.window.x + box.x - area.left;
  const right = area.right - (frame.window.x + box.x + box.width);
  const top = frame.window.y + box.y - area.top;
  const bottom = area.bottom - (frame.window.y + box.y + box.height);
  return frame.orientation === "column"
    ? right >= left
      ? "left"
      : "right"
    : bottom >= top
      ? "top"
      : "bottom";
};

/** Where the tray leaves room for a screenshot, beside the pill on `side`, in the window. */
const roomBeside = (box: Rect, side: Wall): Rect => {
  const far = canvas.width - edgeRoom - pad;
  const near = edgeRoom + pad;
  const beside = { y: box.y + pad, height: box.height - 2 * pad };
  const below = { x: box.x + pad, width: box.width - 2 * pad };
  switch (side) {
    case "left":
      return { ...beside, x: box.x + box.width, width: far - box.x - box.width };
    case "right":
      return { ...beside, x: near, width: box.x - near };
    case "top":
      return { ...below, y: box.y + box.height, height: far - box.y - box.height };
    case "bottom":
      return { ...below, y: near, height: box.y - near };
  }
};

/** Where a screenshot can land in the tray, in screen points: beside the buttons, against the pill. */
export const screenshotSlot = (frame: NotchFrame, area: Area): ScreenshotSlot => {
  const side = pillSide(frame, area);
  const room = roomBeside(boxOf(frame), side);
  return { room: { ...room, x: room.x + frame.window.x, y: room.y + frame.window.y }, hug: side };
};

/** The settings panel's content, beside the pill. */
const panelSize = { width: 260, height: 150 };

/**
 * The settings panel of a docked pill slides out of its wall and pushes the pill off the wall, so
 * the pill rides its edge. `shut` and `open` are its outline drawn against a left wall, like the
 * notch (src/pill/notchShape.ts); its corners on the wall side stay off screen. `content` is where
 * its text sits in the window, and `push` how far the pill moves.
 */
export const panelFromWall = (frame: NotchFrame & { readonly wall: Wall }) => {
  const depth = 300;
  const length = 260;
  const r = pill.radius;
  const mid = frame.along + frame.length / 2;
  const top = Math.min(Math.max(mid - length / 2, edgeRoom), canvas.width - edgeRoom - length);
  const far = canvas.width - depth;
  const flat = { x: 0, y: top, width: depth, height: length };
  const turned = { x: top, y: 0, width: length, height: depth };
  const placed = {
    left: { content: flat, push: { x: depth, y: 0 } },
    right: { content: { ...flat, x: far }, push: { x: -depth, y: 0 } },
    top: { content: turned, push: { x: 0, y: depth } },
    bottom: { content: { ...turned, y: far }, push: { x: 0, y: -depth } },
  }[frame.wall];
  return {
    ...placed,
    shut: roundedPath({ x: -2 * r, y: top, width: 2 * r, height: length }),
    open: roundedPath({ x: -r, y: top, width: depth + r, height: length }),
  };
};

/**
 * Where a floating pill's settings panel puts its content in the window: beside the pill on the
 * side the tray opens to, centred on it and kept inside the window. `trayRects` gives the panel
 * around it.
 */
export const panelBeside = (frame: NotchFrame, area: Area): Rect => {
  const box = boxOf(frame);
  const { width, height } = panelSize;
  const near = edgeRoom + pad;
  const keep = (value: number, length: number) =>
    Math.min(Math.max(value, near), canvas.width - near - length);
  const across = { x: keep(box.x + box.width / 2 - width / 2, width), width, height };
  const along = { y: keep(box.y + box.height / 2 - height / 2, height), width, height };
  switch (pillSide(frame, area)) {
    case "left":
      return { ...along, x: box.x + box.width };
    case "right":
      return { ...along, x: box.x - width };
    case "top":
      return { ...across, y: box.y + box.height };
    case "bottom":
      return { ...across, y: box.y - height };
  }
};

/**
 * The shut tray: the pill's flat rounded end on the side the screenshot `landing` is on. Open, it
 * also covers the screenshot with room around it.
 */
export const trayRects = (frame: NotchFrame, landing: Rect) => {
  const box = boxOf(frame);
  const end = 2 * pill.radius;
  const shut: Rect =
    landing.x >= box.x + box.width - pad
      ? { ...box, x: box.x + box.width - end, width: end }
      : landing.x + landing.width <= box.x + pad
        ? { ...box, width: end }
        : landing.y >= box.y + box.height - pad
          ? { ...box, y: box.y + box.height - end, height: end }
          : { ...box, height: end };
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
