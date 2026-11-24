import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ScreenshotId, landingIn } from "./Screenshot";

describe("landingIn", () => {
  const display = { width: 1440, height: 900 };

  it("fits a docked column notch's width, centred on it", () => {
    const column = { x: 0, y: 600, width: 46, height: 130 };
    assert.deepStrictEqual(landingIn(column, display), { x: 0, y: 651, width: 46, height: 29 });
  });

  it("fits a row notch's height, centred on it", () => {
    const row = { x: 600, y: 850, width: 130, height: 46 };
    assert.deepStrictEqual(landingIn(row, display), { x: 628, y: 850, width: 74, height: 46 });
  });
});

describe("ScreenshotId", () => {
  it("accepts a UUID and rejects anything that could leave a directory", () => {
    const isId = Schema.is(ScreenshotId);
    assert.isTrue(isId("019a5c1e-2b3f-7c4d-8e5f-6a7b8c9d0e1f"));
    assert.isFalse(isId("../active-recording.json"));
  });
});
