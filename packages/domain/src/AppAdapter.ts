import type { FocusSnapshot } from "./Focus";
import type { Rect } from "./Placement";

/**
 * Per-app rules for where the logging overlay sits (GLOSSARY: "app-adapter").
 * Adapters are pure: they choose from a FocusSnapshot and never call the OS.
 * Adding one: docs/operations/adding-app-support.md.
 */
export interface AppAdapter {
  readonly id: string;
  /** macOS bundle ids this adapter handles. Empty for the fallback adapter. */
  readonly bundleIds: ReadonlyArray<string>;
  /** The rect to place the overlay next to (GLOSSARY: Anchor), or null to use the no-anchor position. */
  readonly anchor: (focus: FocusSnapshot) => Rect | null;
}

/** Declares an adapter. Exists so every adapter file reads the same way. */
export const makeAppAdapter = (adapter: AppAdapter): AppAdapter => adapter;

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
