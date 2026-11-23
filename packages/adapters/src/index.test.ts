import { assert, describe, it } from "@effect/vitest";
import type { AppAdapter } from "@kladd/domain";
import { Generic, appAdapters } from "./index";

// Vite resolves import.meta.glob when vitest loads this file; this only types it.
declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true }): Record<string, T>;
  }
}

const notAdapters = new Set(["./index.ts", "./Generic.ts"]);
const adapterFiles = Object.entries(
  import.meta.glob<Record<string, AppAdapter>>("./*.ts", { eager: true }),
).filter(([file]) => !notAdapters.has(file) && !file.endsWith(".test.ts"));

describe("appAdapters", () => {
  it("registers every adapter in src/", () => {
    assert.isNotEmpty(adapterFiles);
    for (const [file, exports] of adapterFiles) {
      for (const adapter of Object.values(exports)) {
        assert.isTrue(
          appAdapters.includes(adapter),
          `${file} exports adapter "${adapter.id}", but it is not in appAdapters in src/index.ts. Add it there.`,
        );
      }
    }
  });

  it("gives each app to one adapter", () => {
    const bundleIds = [Generic, ...appAdapters].flatMap((adapter) => adapter.bundleIds);
    assert.strictEqual(new Set(bundleIds).size, bundleIds.length, "a bundle id is listed twice");
  });
});
