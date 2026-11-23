import { Schema } from "effect";

/**
 * Every window Kladd has. Kladd is overlays only: Settings is the one normal window, and there is
 * no main window.
 * - pill: RecordingPill, recording state on the left screen edge. Always shown.
 * - logging: LoggingOverlay, next to where the user writes; opens when a recording stops.
 * - expanded: ExpandedView, summary and images, opened from the pill.
 * - settings: the only normal window, opened from the pill menu.
 */
export const WindowKind = Schema.Literals(["pill", "logging", "expanded", "settings"]);
export type WindowKind = typeof WindowKind.Type;

/** The UI route each window loads. */
export const windowRoutes = {
  pill: "/overlay/pill",
  logging: "/overlay/logging",
  expanded: "/overlay/expanded",
  settings: "/settings",
} as const satisfies Record<WindowKind, string>;

/**
 * Windows the UI may open itself (contract ShowWindow). Not `logging`: core's LoggingOverlay opens it,
 * because it has to be placed next to where the user writes.
 */
export const OpenableWindow = Schema.Literals(["expanded"]);

/** Windows the UI may close itself (contract HideWindow). Not `pill`: it always stays. */
export const ClosableWindow = Schema.Literals(["logging", "expanded"]);
