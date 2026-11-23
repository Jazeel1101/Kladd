import { assert, describe, it } from "@effect/vitest";
import { Generic, appAdapters } from "./index";

describe("appAdapters", () => {
  it("loads the adapters in src/apps/", () => {
    assert.include(
      appAdapters.map((adapter) => adapter.id),
      "onenote",
    );
  });

  it("loads only adapters", () => {
    for (const adapter of appAdapters) {
      assert.isFunction(
        adapter.anchor,
        "Every export of a file in src/apps/ is loaded as an adapter: export only the makeAppAdapter(...) value, and move helpers out of src/apps/.",
      );
    }
  });

  it("gives each app to one adapter", () => {
    const bundleIds = [Generic, ...appAdapters].flatMap((adapter) => adapter.bundleIds);
    assert.strictEqual(new Set(bundleIds).size, bundleIds.length, "a bundle id is listed twice");
  });
});
