import { assert, describe, it } from "@effect/vitest";
import { overlayMargin, placeBesidePill, placeWithoutPill } from "./Placement";

const screen = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 400, height: 600 };
/** A column notch docked on the left wall, its middle at y = 500. */
const column = { x: 0, y: 435, width: 46, height: 130 };

describe("placeBesidePill", () => {
  it("grows right of a left-docked pill, its panel touching the notch, centred on it", () => {
    const { bounds, join } = placeBesidePill({ notch: column, wall: "left" }, size, screen);
    assert.deepStrictEqual(bounds, { x: 46 - overlayMargin, y: 200, width: 400, height: 600 });
    assert.deepStrictEqual(join, { side: "left", start: 235, end: 365 });
  });

  it("grows left of a right-docked pill", () => {
    const notch = { ...column, x: 1440 - 46 };
    const { bounds, join } = placeBesidePill({ notch, wall: "right" }, size, screen);
    assert.strictEqual(bounds.x + bounds.width - overlayMargin, 1440 - 46);
    assert.strictEqual(join.side, "right");
  });

  it("grows up from a bottom-docked pill, the join along its top", () => {
    const notch = { x: 600, y: 900 - 46, width: 130, height: 46 };
    const { bounds, join } = placeBesidePill({ notch, wall: "bottom" }, size, screen);
    assert.deepStrictEqual(bounds, {
      x: 465,
      y: 900 - 46 - 600 + overlayMargin,
      width: 400,
      height: 600,
    });
    assert.deepStrictEqual(join, { side: "bottom", start: 135, end: 265 });
  });

  it("moves along the wall to stay on screen, keeping the join on the notch", () => {
    const low = { ...column, y: 900 - 160 };
    const { bounds, join } = placeBesidePill({ notch: low, wall: "left" }, size, screen);
    assert.strictEqual(bounds.y, 900 - 600);
    assert.deepStrictEqual(join, { side: "left", start: 440, end: 570 });
  });

  it("grows a floating column toward the side with more room", () => {
    const nearRight = { ...column, x: 1100 };
    assert.strictEqual(
      placeBesidePill({ notch: nearRight, wall: null }, size, screen).join.side,
      "right",
    );
    const nearLeft = { ...column, x: 300 };
    assert.strictEqual(
      placeBesidePill({ notch: nearLeft, wall: null }, size, screen).join.side,
      "left",
    );
  });

  it("grows a floating row up or down, toward the room", () => {
    const high = { x: 600, y: 100, width: 130, height: 46 };
    assert.strictEqual(placeBesidePill({ notch: high, wall: null }, size, screen).join.side, "top");
    const low = { ...high, y: 800 };
    assert.strictEqual(
      placeBesidePill({ notch: low, wall: null }, size, screen).join.side,
      "bottom",
    );
  });

  it("grows a floating row sideways when neither above nor below has room for the panel", () => {
    const middle = { x: 900, y: 440, width: 130, height: 46 };
    const { bounds, join } = placeBesidePill({ notch: middle, wall: null }, size, screen);
    assert.strictEqual(join.side, "right");
    assert.strictEqual(bounds.x + bounds.width - overlayMargin, middle.x);
  });
});

describe("placeWithoutPill", () => {
  it("centres the overlay vertically at the right edge", () => {
    assert.deepStrictEqual(placeWithoutPill(size, screen), {
      x: 1440 - 400 - 8,
      y: 25 + Math.round((875 - 600) / 2),
      width: 400,
      height: 600,
    });
  });
});
