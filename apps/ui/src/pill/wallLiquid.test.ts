import { assert, describe, it } from "@effect/vitest";
import { centerAtGap, frameAt } from "./notchPlacement";
import { dockedLiquid, releaseLiquid, stepLiquid, viewLiquid } from "./wallLiquid";

const area = { left: 0, top: 25, right: 1440, bottom: 900 };
const atGap = (gap: number) =>
  frameAt(centerAtGap("left", gap, { x: 0, y: 460 }, area), "column", "left", area);
const floating = frameAt({ x: 720, y: 460 }, "column", null, area);

describe("stepLiquid", () => {
  it("lets go of a docked pill pulled away from the wall", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(0), true, 0);
    liquid = stepLiquid(liquid, atGap(4), true, 16);
    assert.strictEqual(liquid.mode, "attached");
    liquid = stepLiquid(liquid, atGap(10), true, 32);
    assert.strictEqual(liquid.mode, "leaving");
    assert.strictEqual(liquid.residue?.wall, "left");
  });

  it("keeps the wall's liquid where it was on screen while the window moves", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(0), true, 0);
    liquid = stepLiquid(liquid, floating, true, 16);
    const view = viewLiquid(liquid, floating, 16);
    assert.deepStrictEqual(view.residue?.offset, {
      x: atGap(0).window.x - floating.window.x,
      y: atGap(0).window.y - floating.window.y,
    });
  });

  it("does not let go while springing onto the wall", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(-5), false, 0);
    liquid = stepLiquid(liquid, atGap(3), false, 16);
    assert.strictEqual(liquid.mode, "attached");
  });

  it("attaches again when the pill turns back, with the pull ramping in", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(0), true, 0);
    liquid = stepLiquid(liquid, atGap(40), true, 16);
    liquid = stepLiquid(liquid, atGap(30), true, 500);
    assert.strictEqual(liquid.mode, "attached");
    assert.isAbove(viewLiquid(liquid, atGap(30), 500).shapeGap, 30);
    assert.strictEqual(viewLiquid(liquid, atGap(30), 1000).shapeGap, 30);
  });

  it("reaches for the pill again when let go of in the zone", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(0), true, 0);
    liquid = stepLiquid(liquid, atGap(40), true, 16);
    assert.strictEqual(releaseLiquid(liquid, 20).mode, "attached");
  });
});

describe("viewLiquid", () => {
  it("sinks the wall's liquid back and then forgets it", () => {
    let liquid = stepLiquid(dockedLiquid("left"), atGap(0), true, 0);
    liquid = stepLiquid(liquid, atGap(10), true, 100);
    assert.strictEqual(viewLiquid(liquid, atGap(10), 100).residue?.scale, 1);
    assert.isBelow(viewLiquid(liquid, atGap(10), 200).residue?.scale ?? 1, 1);
    assert.isNull(viewLiquid(liquid, atGap(10), 400).residue);
    assert.isFalse(viewLiquid(liquid, atGap(10), 400).animating);
  });
});
