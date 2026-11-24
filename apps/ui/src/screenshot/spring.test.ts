import { assert, describe, it } from "@effect/vitest";
import { springTiming } from "./spring";

const points = (easing: string) => easing.slice("linear(".length, -1).split(", ").map(Number);

describe("springTiming", () => {
  it("starts at 0, ends at 1, and a bouncy spring overshoots", () => {
    const bouncy = points(springTiming({ stiffness: 170, damping: 12 }).easing);
    assert.strictEqual(bouncy[0], 0);
    assert.strictEqual(bouncy.at(-1), 1);
    assert.isAbove(Math.max(...bouncy), 1);
  });

  it("a critically damped spring never overshoots", () => {
    const stiffness = 170;
    const smooth = points(springTiming({ stiffness, damping: 2 * Math.sqrt(stiffness) }).easing);
    assert.isAtMost(Math.max(...smooth), 1);
  });

  it("a stiffer spring settles sooner", () => {
    const soft = springTiming({ stiffness: 100, damping: 20 }).duration;
    const stiff = springTiming({ stiffness: 400, damping: 40 }).duration;
    assert.isBelow(stiff, soft);
  });
});
