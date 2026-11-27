import { assert, describe, it } from "@effect/vitest";
import { overlayMargin } from "@kladd/domain";
import { growOrigin, neck } from "./neck";

const window = { width: 416, height: 596 };
const panel = { width: 416 - 2 * overlayMargin, height: 596 - 2 * overlayMargin };
const m = overlayMargin;

describe("neck", () => {
  it("flares from the notch's span into the panel's side, as round as the notch", () => {
    const { d, transform } = neck({ side: "left", start: 200, end: 330 }, window);
    assert.strictEqual(
      d,
      `M${m + 2} 180 L${m} 180 A20 20 0 0 1 ${m - 20} 200 L${m - 20} 330 A20 20 0 0 1 ${m} 350 L${m + 2} 350 Z`,
    );
    assert.strictEqual(transform, "matrix(1 0 0 1 0 0)");
  });

  it("is mirrored onto the right side and turned onto the bottom", () => {
    assert.strictEqual(
      neck({ side: "right", start: 0, end: 0 }, window).transform,
      "matrix(-1 0 0 1 416 0)",
    );
    // A point drawn at depth u, along v lands at (v, height - u).
    assert.strictEqual(
      neck({ side: "bottom", start: 0, end: 0 }, window).transform,
      "matrix(0 -1 1 0 0 596)",
    );
  });
});

describe("growOrigin", () => {
  it("grows the panel from the middle of the notch, on the join's side", () => {
    const join = { start: m + 100, end: m + 230 };
    assert.strictEqual(growOrigin({ side: "left", ...join }, panel), "0px 165px");
    assert.strictEqual(growOrigin({ side: "right", ...join }, panel), `${panel.width}px 165px`);
    assert.strictEqual(growOrigin({ side: "bottom", ...join }, panel), `165px ${panel.height}px`);
  });
});
