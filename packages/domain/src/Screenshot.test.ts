import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ScreenshotId, pillTarget } from "./Screenshot";

describe("pillTarget", () => {
  it("is centred on the pill, as tall as it, with the display's aspect ratio", () => {
    const pill = { x: 8, y: 700, width: 132, height: 36 };
    assert.deepStrictEqual(pillTarget(pill, { width: 1440, height: 900 }), {
      x: 45,
      y: 700,
      width: 58,
      height: 36,
    });
  });
});

describe("ScreenshotId", () => {
  it("accepts a UUID and rejects anything that could leave a directory", () => {
    const isId = Schema.is(ScreenshotId);
    assert.isTrue(isId("019a5c1e-2b3f-7c4d-8e5f-6a7b8c9d0e1f"));
    assert.isFalse(isId("../active-recording.json"));
  });
});
