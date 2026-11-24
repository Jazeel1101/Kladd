import { assert, describe, it } from "@effect/vitest";
import { screenshotSlot } from "./intake";
import { frameAt } from "./notchPlacement";

const area = { left: 0, top: 0, right: 1440, bottom: 900 };

describe("screenshotSlot", () => {
  it("leaves the strip by the left wall to the buttons and takes the rest", () => {
    const frame = frameAt({ x: 23, y: 450 }, "column", "left", area);
    assert.deepStrictEqual(screenshotSlot(frame), { x: 46, y: 393, width: 118, height: 114 });
  });

  it("opens upward from the bottom wall, above the buttons", () => {
    const frame = frameAt({ x: 720, y: 877 }, "row", "bottom", area);
    assert.deepStrictEqual(screenshotSlot(frame), { x: 663, y: 736, width: 114, height: 118 });
  });

  it("spans a floating pill, which opens both ways", () => {
    const frame = frameAt({ x: 500, y: 450 }, "column", null, area);
    assert.deepStrictEqual(screenshotSlot(frame), { x: 433, y: 393, width: 134, height: 114 });
  });
});
