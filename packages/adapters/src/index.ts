import type { AppAdapter } from "@kladd/domain";

export { Generic } from "./Generic";

// Vite (vitest) and rolldown (vp pack) replace import.meta.glob at build time; this only types it.
declare global {
  interface ImportMeta {
    glob<T>(patterns: ReadonlyArray<string>, options: { eager: true }): Record<string, T>;
  }
}

/** Every app with its own adapter: each export of each file in src/apps/. */
export const appAdapters: ReadonlyArray<AppAdapter> = Object.values(
  import.meta.glob<Record<string, AppAdapter>>(["./apps/*.ts", "!./apps/*.test.ts"], {
    eager: true,
  }),
).flatMap((exports) => Object.values(exports));
