import { assert, describe, it } from "@effect/vitest";
import { centerAtGap, clampCenter, frameAt, restingCenter, zoneAt } from "./notchPlacement";
import { attractRange, canvas, flare, pill, pillLength } from "./notchShape";

/** The pill with three buttons. */
const long = pillLength(3);

/** Where a floating pill sits in its window, centred. */
const inset = (canvas.width - pill.width) / 2;

const area = { left: 0, top: 25, right: 1440, bottom: 900 };
const middle = { x: 720, y: 460 };

describe("zoneAt", () => {
  it("floats in the middle of the screen", () => {
    assert.isNull(zoneAt(middle, area, long));
  });

  it("is the left wall's zone once the pill is closer than attractRange", () => {
    const inside = { x: pill.width / 2 + attractRange - 1, y: 460 };
    const outside = { x: pill.width / 2 + attractRange + 1, y: 460 };
    assert.strictEqual(zoneAt(inside, area, long), "left");
    assert.isNull(zoneAt(outside, area, long));
  });

  it("measures the bottom wall against the pill as a row", () => {
    // A column this close to the bottom would be 65 from it, but as a row it is 20 away.
    assert.strictEqual(
      zoneAt({ x: 720, y: area.bottom - pill.width / 2 - 20 }, area, long),
      "bottom",
    );
  });

  it("has no zone along the top", () => {
    assert.isNull(zoneAt({ x: 720, y: area.top + pill.width / 2 }, area, long));
  });

  it("swaps walls in a corner where the pill crosses its diagonal", () => {
    const nearerLeft = { x: pill.width / 2 + 20, y: area.bottom - pill.width / 2 - 30 };
    const nearerBottom = { x: pill.width / 2 + 30, y: area.bottom - pill.width / 2 - 20 };
    assert.strictEqual(zoneAt(nearerLeft, area, long), "left");
    assert.strictEqual(zoneAt(nearerBottom, area, long), "bottom");
  });
});

describe("clampCenter", () => {
  it("keeps room for the docked flare along the wall it is in", () => {
    const high = clampCenter({ x: 23, y: 0 }, "column", "left", area, long);
    assert.strictEqual(high.y, area.top + flare + long / 2);
  });

  it("keeps both layouts at the same place on a corner's diagonal, even pressed into it", () => {
    for (const depth of [40, 10, -30]) {
      const raw = { x: area.left + depth, y: area.bottom - depth };
      const column = clampCenter(raw, "column", "left", area, long);
      const row = clampCenter(raw, "row", "bottom", area, long);
      assert.closeTo(column.x, row.x, 1e-9);
      assert.closeTo(column.y, row.y, 1e-9);
    }
  });
});

describe("restingCenter", () => {
  it("rests on the wall with the flare on screen, out of the corner", () => {
    const rest = restingCenter("left", { x: 60, y: area.bottom - 50 }, area, long);
    assert.strictEqual(rest.x, area.left + pill.width / 2);
    assert.strictEqual(rest.y, area.bottom - flare - long / 2);
  });
});

describe("frameAt in a corner", () => {
  // Gaps from the left wall (as a column) and the bottom wall (as a row), in the bottom-left corner.
  const at = (left: number, bottom: number) => ({
    x: area.left + pill.width / 2 + left,
    y: area.bottom - pill.width / 2 - bottom,
  });

  it("is half turned on the diagonal, where neither wall pulls", () => {
    const column = frameAt(at(30, 30), "column", "left", area, long);
    const row = frameAt(at(30, 30), "row", "bottom", area, long);
    assert.strictEqual(Math.abs(column.tilt), 45);
    assert.strictEqual(Math.abs(row.tilt), 45);
    assert.strictEqual(column.pull, 0);
    assert.strictEqual(row.pull, 0);
  });

  it("turns back as one wall gets clearly nearer", () => {
    const frame = frameAt(at(10, 30), "column", "left", area, long);
    assert.isAbove(Math.abs(frame.tilt), 0);
    assert.isBelow(Math.abs(frame.tilt), 45);
    assert.strictEqual(frameAt(at(10, 60), "column", "left", area, long).tilt, 0);
    assert.strictEqual(frameAt(at(10, 60), "column", "left", area, long).pull, 1);
  });

  it("rolls round each corner: lies across it on the diagonal", () => {
    // Bottom-left: a column turns counterclockwise onto the bottom; bottom-right: clockwise.
    assert.strictEqual(frameAt(at(30, 30), "column", "left", area, long).tilt, -45);
    const right = { x: area.right - pill.width / 2 - 30, y: area.bottom - pill.width / 2 - 30 };
    assert.strictEqual(frameAt(right, "column", "right", area, long).tilt, 45);
    assert.strictEqual(frameAt(right, "row", "bottom", area, long).tilt, -45);
  });

  it("is not turned near the top, which has no zone", () => {
    const high = { x: area.left + pill.width / 2 + 10, y: area.top + pill.width / 2 + 10 };
    assert.strictEqual(frameAt(high, "column", "left", area, long).tilt, 0);
  });

  it("is not turned along a wall away from corners", () => {
    assert.strictEqual(
      frameAt(centerAtGap("left", 10, middle, area, long), "column", "left", area, long).tilt,
      0,
    );
  });
});

describe("frameAt", () => {
  it("centres the window on a floating pill and draws it plain", () => {
    const frame = frameAt(middle, "column", null, area, long);
    assert.deepStrictEqual(frame.window, {
      x: middle.x - canvas.width / 2,
      y: middle.y - canvas.height / 2,
    });
    assert.strictEqual(frame.offset, inset);
    assert.strictEqual(frame.box.left, inset);
  });

  it("draws a floating pill where it sits when the screen's edge holds its window in", () => {
    const frame = frameAt({ x: area.left + 123, y: 460 }, "column", null, area, long);
    assert.strictEqual(frame.window.x, area.left);
    assert.strictEqual(frame.box.left, 100);
    assert.strictEqual(frame.offset, frame.box.left);
    // Still out of every wall's reach, as far as the wall's liquid is concerned.
    assert.strictEqual(frame.gap, attractRange);
  });

  it("turns a floating pill into a row about its centre, still plain", () => {
    const column = frameAt(middle, "column", null, area, long);
    const row = frameAt(middle, "row", null, area, long);
    assert.deepStrictEqual(row.window, column.window);
    assert.strictEqual(row.drawWall, "top");
    assert.strictEqual(row.box.top, inset);
    assert.strictEqual(row.along, row.box.left);
  });

  it("holds the window against the wall and moves the pill inside it", () => {
    const frame = frameAt(
      centerAtGap("right", 10, middle, area, long),
      "column",
      "right",
      area,
      long,
    );
    assert.strictEqual(frame.window.x, area.right - canvas.width);
    assert.strictEqual(frame.gap, 10);
    assert.strictEqual(frame.box.left + pill.width, canvas.width - 10);
  });

  it("lays the pill out as a row on the bottom wall", () => {
    const frame = frameAt(
      centerAtGap("bottom", 0, middle, area, long),
      "row",
      "bottom",
      area,
      long,
    );
    assert.strictEqual(frame.box.width, long);
    assert.strictEqual(frame.box.top + pill.width, canvas.height);
    assert.strictEqual(frame.along, frame.box.left);
  });

  it("keeps the centre of a pill that loses a button", () => {
    const docked = frameAt(
      centerAtGap("left", 0, middle, area, long),
      "column",
      "left",
      area,
      long,
    );
    const short = frameAt(
      centerAtGap("left", 0, middle, area, long),
      "column",
      "left",
      area,
      pillLength(2),
    );
    assert.isBelow(short.box.height, docked.box.height);
    assert.strictEqual(
      short.box.top + short.box.height / 2,
      docked.box.top + docked.box.height / 2,
    );
    assert.strictEqual(short.gap, 0);
  });
});
