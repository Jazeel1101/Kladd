import { assert, describe, it } from "@effect/vitest";
import { panelBeside, panelFromWall, screenshotSlot, trayRects } from "./intake";
import { frameAt } from "./notchPlacement";
import { pillLength } from "./notchShape";

/** The pill with three buttons. */
const long = pillLength(3);

const area = { left: 0, top: 0, right: 1440, bottom: 900 };
const leftWall = frameAt({ x: 23, y: 450 }, "column", "left", area, long);
/** Floating left of the middle: more of the screen lies to its right. */
const floating = frameAt({ x: 500, y: 450 }, "column", null, area, long);

describe("screenshotSlot", () => {
  it("leaves the strip by the left wall to the buttons and keeps to it", () => {
    assert.deepStrictEqual(screenshotSlot(leftWall, area), {
      room: { x: 46, y: 393, width: 472, height: 114 },
      hug: "left",
    });
  });

  it("opens upward from the bottom wall, ending at the pill", () => {
    const frame = frameAt({ x: 720, y: 877 }, "row", "bottom", area, long);
    assert.deepStrictEqual(screenshotSlot(frame, area), {
      room: { x: 663, y: 382, width: 114, height: 472 },
      hug: "bottom",
    });
  });

  it("opens a floating pill toward the side with more of the screen", () => {
    assert.deepStrictEqual(screenshotSlot(floating, area), {
      room: { x: 523, y: 393, width: 215, height: 114 },
      hug: "left",
    });
    const nearRight = frameAt({ x: 1100, y: 450 }, "column", null, area, long);
    assert.deepStrictEqual(screenshotSlot(nearRight, area), {
      room: { x: 862, y: 393, width: 215, height: 114 },
      hug: "right",
    });
  });
});

describe("trayRects", () => {
  it("shuts into the pill's flat end and opens just past the screenshot", () => {
    // The pill's box is 215 down the window; the screenshot lands a pad below its top.
    const landing = { x: 46, y: 223, width: 182, height: 114 };
    assert.deepStrictEqual(trayRects(leftWall, landing), {
      shut: { x: 6, y: 215, width: 40, height: 130 },
      open: { x: 6, y: 215, width: 230, height: 130 },
    });
  });

  it("shuts into the end facing the screenshot, on whichever side it landed", () => {
    const landing = { x: 75, y: 223, width: 182, height: 114 };
    assert.deepStrictEqual(trayRects(floating, landing), {
      shut: { x: 257, y: 215, width: 40, height: 130 },
      open: { x: 67, y: 215, width: 230, height: 130 },
    });
  });
});

describe("settings panel", () => {
  it("slides a floating pill's panel out toward the side with more of the screen", () => {
    const panel = panelBeside(floating, area);
    assert.strictEqual(panel.x, floating.box.left + floating.box.width);
    assert.strictEqual(panel.y + panel.height / 2, floating.box.top + floating.box.height / 2);
  });

  it("pushes a docked pill off its wall by the panel's depth", () => {
    const left = panelFromWall({ ...leftWall, wall: "left" });
    assert.deepStrictEqual(left.push, { x: 300, y: 0 });
    assert.deepStrictEqual(left.content, { x: 0, y: 150, width: 300, height: 260 });
    const frame = frameAt({ x: 720, y: 877 }, "row", "bottom", area, long);
    const bottom = panelFromWall({ ...frame, wall: "bottom" });
    assert.deepStrictEqual(bottom.push, { x: 0, y: -300 });
    assert.strictEqual(bottom.content.y + bottom.content.height, 560);
  });
});
