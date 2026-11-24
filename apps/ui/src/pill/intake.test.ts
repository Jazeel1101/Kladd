import { assert, describe, it } from "@effect/vitest";
import { screenshotSlot, trayRects } from "./intake";
import { frameAt } from "./notchPlacement";

const area = { left: 0, top: 0, right: 1440, bottom: 900 };
const leftWall = frameAt({ x: 23, y: 450 }, "column", "left", area);

describe("screenshotSlot", () => {
  it("leaves the strip by the left wall to the buttons and keeps to it", () => {
    assert.deepStrictEqual(screenshotSlot(leftWall), {
      room: { x: 46, y: 393, width: 252, height: 114 },
      hug: "left",
    });
  });

  it("opens upward from the bottom wall, ending at the pill", () => {
    const frame = frameAt({ x: 720, y: 877 }, "row", "bottom", area);
    assert.deepStrictEqual(screenshotSlot(frame), {
      room: { x: 663, y: 602, width: 114, height: 252 },
      hug: "bottom",
    });
  });

  it("opens both ways from a floating pill's middle", () => {
    const frame = frameAt({ x: 500, y: 450 }, "column", null, area);
    assert.deepStrictEqual(screenshotSlot(frame), {
      room: { x: 372, y: 393, width: 256, height: 114 },
      hug: null,
    });
  });
});

describe("trayRects", () => {
  it("shuts into the pill's flat end and opens just past the screenshot", () => {
    // The pill's box is 105 down the window; the screenshot lands a pad below its top.
    const landing = { x: 46, y: 113, width: 182, height: 114 };
    assert.deepStrictEqual(trayRects(leftWall, landing), {
      shut: { x: 6, y: 105, width: 40, height: 130 },
      open: { x: 6, y: 105, width: 230, height: 130 },
    });
  });
});
