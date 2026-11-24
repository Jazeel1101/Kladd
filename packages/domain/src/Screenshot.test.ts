import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { ScreenshotId, landingIn } from "./Screenshot";

describe("landingIn", () => {
  const display = { width: 1440, height: 900 };

  it("fills the room's height beside a pill on the left wall, against the pill", () => {
    const room = { x: 46, y: 608, width: 252, height: 114 };
    assert.deepStrictEqual(landingIn({ room, hug: "left" }, display), {
      x: 46,
      y: 608,
      width: 182,
      height: 114,
    });
  });

  it("keeps to the bottom above a pill on the bottom wall", () => {
    const room = { x: 600, y: 500, width: 114, height: 252 };
    assert.deepStrictEqual(landingIn({ room, hug: "bottom" }, display), {
      x: 600,
      y: 681,
      width: 114,
      height: 71,
    });
  });

  it("centres on a floating pill", () => {
    const room = { x: 0, y: 0, width: 256, height: 114 };
    assert.deepStrictEqual(landingIn({ room, hug: null }, display), {
      x: 37,
      y: 0,
      width: 182,
      height: 114,
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
