import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { ScreenshotId } from "@kladd/domain";
import type { ScreenCapture } from "../ports/ScreenCapture";
import {
  IdsTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
  ScreenCaptureTest,
  ScreenshotFilesTest,
} from "../testing";
import { Screenshots } from "./Screenshots";

const withCapture = (capture: Layer.Layer<ScreenCapture> = ScreenCaptureTest.granted) =>
  Effect.provide(
    Screenshots.layer.pipe(
      Layer.provide([capture, IdsTest, ScreenshotFilesTest]),
      Layer.provideMerge(OverlayWindowsTest),
    ),
  );

/** The tray now. */
const tray = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  return Option.getOrUndefined(yield* Stream.runHead(screenshots.changes));
});

const shownWindows = Effect.gen(function* () {
  return (yield* Ref.get(yield* OverlayWindowsLog)).map((shown) => shown.kind);
});

const display = { x: 0, y: 0, width: 1440, height: 900 };
/** The slot of a pill docked on the left wall, as the pill reports it. */
const slot = { room: { x: 46, y: 608, width: 252, height: 114 }, hug: "left" as const };

/** Takes a screenshot once the pill has reported its slot. */
const takeAimed = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  yield* screenshots.aimAt(slot);
  return yield* screenshots.take;
});

/** Lands a screenshot, waiting out the moment main gives the pill to draw it. */
const land = Effect.fn("test.land")(function* (id: ScreenshotId) {
  const screenshots = yield* Screenshots;
  const landing = yield* Effect.forkChild(screenshots.land(id));
  yield* TestClock.adjust("1 second");
  yield* Fiber.join(landing);
});

describe("Screenshots.take", () => {
  it.effect("flies the screenshot from the whole display into the pill's slot", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.deepStrictEqual((yield* tray)?.flying, {
        screenshot,
        from: display,
        to: { x: 46, y: 608, width: 182, height: 114 },
      });
      assert.deepStrictEqual(screenshot.display, display);
      // Only the flight window: the logging overlay stays as it was.
      assert.deepStrictEqual(yield* Ref.get(yield* OverlayWindowsLog), [
        { kind: "flight", bounds: display },
      ]);
    }).pipe(withCapture()),
  );

  it.effect("attaches the screenshot at once while the pill hasn't said where it is", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const screenshot = yield* screenshots.take;
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [screenshot] });
      assert.deepStrictEqual(yield* shownWindows, []);
    }).pipe(withCapture()),
  );

  it.effect("lands a screenshot still flying, so only one flies at a time", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      const second = yield* takeAimed;
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.deepStrictEqual(
        now?.attached.map((s) => s.id),
        [first.id],
      );
    }).pipe(withCapture()),
  );

  it.effect("asks for permission, and takes nothing when it is denied", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(takeAimed);
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [] });
      assert.deepStrictEqual(yield* shownWindows, []);
    }).pipe(withCapture(ScreenCaptureTest.denied)),
  );

  it.effect("takes the screenshot once the user grants permission", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.strictEqual((yield* tray)?.flying?.screenshot.id, screenshot.id);
    }).pipe(withCapture(ScreenCaptureTest.grantedOnRequest)),
  );
});

describe("Screenshots.land", () => {
  it.effect("attaches the screenshot in flight and hides the flight window", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      yield* land(screenshot.id);
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [screenshot] });
      assert.deepStrictEqual(yield* Ref.get(yield* OverlayWindowsLog), [
        { kind: "flight", bounds: display },
        { kind: "flight", bounds: undefined, hidden: true },
      ]);
    }).pipe(withCapture()),
  );

  it.effect("moves the screenshot in flight to the front of the attached ones", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      yield* land(first.id);
      const second = yield* takeAimed;
      yield* land(second.id);
      const now = yield* tray;
      assert.isNull(now?.flying);
      assert.deepStrictEqual(
        now?.attached.map((s) => s.id),
        [second.id, first.id],
      );
    }).pipe(withCapture()),
  );

  it.effect("ignores an older flight, and leaves the window to the newer one", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      const second = yield* takeAimed;
      // The first flight finishes after the second has started.
      yield* land(first.id);
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.strictEqual(now?.attached.length, 1);
      assert.deepStrictEqual(yield* shownWindows, ["flight", "flight"]);
    }).pipe(withCapture()),
  );
});
