import type { FocusSnapshot } from "./Focus";
import type { OverlayPlacement, Rect } from "./Placement";
import type { WritingTarget } from "./WritingTarget";

/**
 * Per-app rules for the logging overlay (GLOSSARY: "app-adapter"): where it sits, and what it says
 * the user is writing in. Adapters are pure: they read a FocusSnapshot and never call the OS.
 * Adding one: docs/operations/adding-app-support.md.
 */
export interface AppAdapter {
  readonly id: string;
  /** macOS bundle ids this adapter handles. Empty for the fallback adapter. */
  readonly bundleIds: ReadonlyArray<string>;
  /** The rect to place the overlay next to (GLOSSARY: Anchor), or null to use the no-anchor position. */
  readonly anchor: (focus: FocusSnapshot) => Rect | null;
  /** Whether the overlay sits beside the anchor or inside its top-right corner. */
  readonly placement: OverlayPlacement;
  /** What the user is writing in (GLOSSARY: WritingTarget). */
  readonly target: (focus: FocusSnapshot) => WritingTarget;
}

/** The app's name and its focused window's title: what an adapter reports unless it knows better. */
export const defaultTarget = (focus: FocusSnapshot): WritingTarget => ({
  app: focus.app?.name ?? null,
  document: focus.title,
});

/**
 * Declares an adapter, so every adapter file reads the same way. `target` defaults to defaultTarget,
 * `placement` to "beside".
 */
export const makeAppAdapter = (
  adapter: Omit<AppAdapter, "target" | "placement"> &
    Partial<Pick<AppAdapter, "target" | "placement">>,
): AppAdapter => ({ target: defaultTarget, placement: "beside", ...adapter });

/** The adapter for the front app, or `fallback` when none matches. */
export const adapterFor = (
  adapters: ReadonlyArray<AppAdapter>,
  fallback: AppAdapter,
  focus: FocusSnapshot,
): AppAdapter => {
  const bundleId = focus.app?.bundleId;
  if (bundleId === undefined) return fallback;
  return adapters.find((adapter) => adapter.bundleIds.includes(bundleId)) ?? fallback;
};
