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
 * Where a new screenshot lands: the largest rect with the display's aspect ratio that fits inside the
 * pill's notch at `notch`, centred on it. From there it drops into the pill and disappears.
 */
export const landingIn = (notch: Rect, display: Size): Rect => {
  const scale = Math.min(notch.width / display.width, notch.height / display.height);
  const width = Math.round(display.width * scale);
  const height = Math.round(display.height * scale);
  return {
    x: notch.x + Math.round((notch.width - width) / 2),
    y: notch.y + Math.round((notch.height - height) / 2),
    width,
    height,
  };
};
