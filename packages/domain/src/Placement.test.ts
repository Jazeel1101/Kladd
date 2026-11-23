import { assert, describe, it } from "@effect/vitest";
import { placeOverlay, placeWithoutAnchor } from "./Placement";

const screen = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 320, height: 400 };

describe("placeOverlay", () => {
  it("puts the overlay right of the anchor, top-aligned", () => {
    const anchor = { x: 100, y: 200, width: 2, height: 18 };
    assert.deepStrictEqual(placeOverlay(anchor, size, screen), {
      x: 110,
      y: 200,
      width: 320,
      height: 400,
    });
  });

  it("flips to the left when the right side doesn't fit", () => {
    const anchor = { x: 1300, y: 200, width: 2, height: 18 };
    assert.strictEqual(placeOverlay(anchor, size, screen).x, 1300 - 8 - 320);
  });

  it("stays on screen when neither side fits", () => {
    const anchor = { x: 0, y: 200, width: 1440, height: 18 };
    const rect = placeOverlay(anchor, size, screen);
    assert.strictEqual(rect.x, 1440 - 320);
  });

  it("moves up when the anchor is near the bottom", () => {
    const anchor = { x: 100, y: 880, width: 2, height: 18 };
    assert.strictEqual(placeOverlay(anchor, size, screen).y, 25 + 875 - 400);
  });

  it("flips on a second display left of the main one (negative x)", () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const anchor = { x: -100, y: 100, width: 2, height: 18 };
    assert.strictEqual(placeOverlay(anchor, size, left).x, -100 - 8 - 320);
  });
});

describe("placeWithoutAnchor", () => {
  it("centres the overlay vertically at the right edge", () => {
    assert.deepStrictEqual(placeWithoutAnchor(size, screen), {
      x: 1440 - 320 - 8,
      y: 25 + Math.round((875 - 400) / 2),
      width: 320,
      height: 400,
    });
  });
});
