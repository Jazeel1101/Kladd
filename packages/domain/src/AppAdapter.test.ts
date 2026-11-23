import { assert, describe, it } from "@effect/vitest";
import { adapterFor, makeAppAdapter } from "./AppAdapter";
import { emptyFocus } from "./Focus";

const fallback = makeAppAdapter({ id: "generic", bundleIds: [], anchor: (f) => f.window });
const notes = makeAppAdapter({
  id: "notes",
  bundleIds: ["com.apple.Notes"],
  anchor: (f) => f.caret,
});

describe("adapterFor", () => {
  it("picks the adapter whose bundle id matches the front app", () => {
    const focus = { ...emptyFocus, app: { bundleId: "com.apple.Notes", name: "Notes" } };
    assert.strictEqual(adapterFor([notes], fallback, focus).id, "notes");
  });

  it("falls back when no adapter matches", () => {
    const focus = { ...emptyFocus, app: { bundleId: "com.example.Other", name: "Other" } };
    assert.strictEqual(adapterFor([notes], fallback, focus).id, "generic");
  });

  it("falls back when the front app is unknown", () => {
    assert.strictEqual(adapterFor([notes], fallback, emptyFocus).id, "generic");
  });
});
