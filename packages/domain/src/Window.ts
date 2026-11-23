import { Schema } from "effect";

/**
 * Every window Kladd has. Kladd is overlays only: Settings is the one normal window, and there is
 * no main window. Each kind has one row in apps/desktop/src/main/windows.ts and one UI route.
 * - pill: RecordingPill, recording state on the left screen edge. Always shown.
 * - logging: LoggingOverlay, next to where the user writes; opens when a recording stops.
 * - expanded: ExpandedView, summary and images, opened from the pill.
 * - settings: the only normal window, opened from the pill menu.
 */
export const WindowKind = Schema.Literals(["pill", "logging", "expanded", "settings"]);
export type WindowKind = typeof WindowKind.Type;
