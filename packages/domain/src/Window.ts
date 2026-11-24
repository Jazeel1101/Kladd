import { Schema } from "effect";

/**
 * Every window Kladd has. Kladd is overlays only: Settings is the one normal window, and there is
 * no main window.
 * - pill: RecordingPill, docked on a screen edge or floating. Always shown.
 * - zones: SnapZones, the screen edges where the pill docks; shown while the pill is dragged.
 * - logging: LoggingOverlay, next to where the user writes; opens when a recording stops.
 * - expanded: ExpandedView, summary and images, opened from the pill.
 * - settings: the only normal window, opened from the pill menu.
 * - flight: ScreenshotFlight, a click-through overlay over the whole display that flies a new
 *   screenshot into the pill.
 */
export const WindowKind = Schema.Literals([
  "pill",
  "zones",
  "logging",
  "expanded",
  "settings",
  "flight",
]);
export type WindowKind = typeof WindowKind.Type;

/**
 * Windows the UI may open itself (contract ShowWindow). Not `logging`: core's LoggingOverlay opens it,
 * because it has to be placed next to where the user writes.
 */
export const OpenableWindow = Schema.Literals(["expanded", "zones"]);

/** Windows the UI may close itself (contract HideWindow). Not `pill`: it always stays. */
export const ClosableWindow = Schema.Literals(["logging", "expanded", "zones"]);
