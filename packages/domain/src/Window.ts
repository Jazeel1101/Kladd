import { Schema } from "effect";

/**
 * Every window Kladd has. Kladd is overlays only: Settings is the one normal window, and there is
 * no main window.
 * - pill: RecordingPill, docked on a screen edge or floating. Always shown.
 * - zones: SnapZones, the screen edges where the pill docks; shown while the pill is dragged.
 * - logging: LoggingOverlay, grown out of the pill; opens when a session ends.
 * - expanded: ExpandedView, the past sessions, opened from the pill.
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
 * because it grows out of wherever the pill rests.
 */
export const OpenableWindow = Schema.Literals(["expanded", "zones"]);

/**
 * Windows the UI may close itself (contract HideWindow). Not `pill`: it always stays. Not `logging`:
 * core's LoggingOverlay closes it (contract ToggleLoggingOverlay), because it follows focus while open.
 */
export const ClosableWindow = Schema.Literals(["expanded", "zones"]);

/**
 * Windows larger than what they draw, which let clicks through their empty space (contract
 * SetClickThrough): the UI turns that off while the pointer is over what it draws.
 */
export const ClickThroughWindow = Schema.Literals(["pill", "logging"]);
