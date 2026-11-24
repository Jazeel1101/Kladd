import { Schema } from "effect";
import { Rect, type Size } from "./Placement";

/** Identifies one screenshot. A UUID, because it also names the screenshot's file and URL. */
export const ScreenshotId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ScreenshotId"));
export type ScreenshotId = typeof ScreenshotId.Type;

/** A screenshot of the whole main display, taken with ⌃⇧C and attached to the log being written. */
export class Screenshot extends Schema.Class<Screenshot, { readonly brand: unique symbol }>(
  "Screenshot",
)({
  id: ScreenshotId,
  takenAt: Schema.DateTimeUtc,
  /** The display it shows, in points: its size is the screenshot's aspect ratio. */
  display: Rect,
}) {}

/**
 * A screenshot on its way from the screen into the pill (GLOSSARY: ScreenshotFlight).
 * The flight window starts it covering `from` and lands it on `to`, both in screen points.
 */
export const ScreenshotFlight = Schema.Struct({
  screenshot: Screenshot,
  from: Rect,
  to: Rect,
});
export type ScreenshotFlight = typeof ScreenshotFlight.Type;

/**
 * The screenshots of the log being written: the one in flight, if any, and the landed ones, newest
 * first.
 */
export const ScreenshotTray = Schema.Struct({
  flying: Schema.NullOr(ScreenshotFlight),
  attached: Schema.Array(Screenshot),
});
export type ScreenshotTray = typeof ScreenshotTray.Type;

export const emptyScreenshotTray: ScreenshotTray = { flying: null, attached: [] };

/**
 * Where a new screenshot can land in the pill, in screen points: the most room the pill's tray can
 * open to, and the side of it the pill is on, which the screenshot keeps to so the tray hugs it.
 * Null `hug` centres it, for a floating pill whose tray opens both ways.
 */
export const ScreenshotSlot = Schema.Struct({
  room: Rect,
  hug: Schema.NullOr(Schema.Literals(["left", "right", "top", "bottom"])),
});
export type ScreenshotSlot = typeof ScreenshotSlot.Type;

/**
 * Where a new screenshot lands: the largest rect with the display's aspect ratio that fits in the
 * slot's room, against its `hug` side and centred the other way.
 */
export const landingIn = ({ room, hug }: ScreenshotSlot, display: Size): Rect => {
  const scale = Math.min(room.width / display.width, room.height / display.height);
  const width = Math.round(display.width * scale);
  const height = Math.round(display.height * scale);
  const x =
    hug === "left"
      ? room.x
      : hug === "right"
        ? room.x + room.width - width
        : room.x + Math.round((room.width - width) / 2);
  const y =
    hug === "top"
      ? room.y
      : hug === "bottom"
        ? room.y + room.height - height
        : room.y + Math.round((room.height - height) / 2);
  return { x, y, width, height };
};
