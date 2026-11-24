import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Stream } from "effect";
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
/** A column notch docked on the left wall, as the pill reports it. */
const notch = { x: 0, y: 600, width: 46, height: 130 };

/** Takes a screenshot once the pill has reported its notch. */
const takeAimed = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  yield* screenshots.aimAt(notch);
  return yield* screenshots.take;
});

describe("Screenshots.take", () => {
  it.effect("flies the screenshot from the whole display into the pill's notch", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.deepStrictEqual((yield* tray)?.flying, {
        screenshot,
        from: display,
        to: { x: 0, y: 651, width: 46, height: 29 },
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
  it.effect("moves the screenshot in flight to the front of the attached ones", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const first = yield* takeAimed;
      yield* screenshots.land(first.id);
      const second = yield* takeAimed;
      yield* screenshots.land(second.id);
      const now = yield* tray;
      assert.isNull(now?.flying);
      assert.deepStrictEqual(
        now?.attached.map((s) => s.id),
        [second.id, first.id],
      );
    }).pipe(withCapture()),
  );

  it.effect("ignores a screenshot that is not the one in flight", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const first = yield* takeAimed;
      const second = yield* takeAimed;
      yield* screenshots.land(first.id);
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.strictEqual(now?.attached.length, 1);
    }).pipe(withCapture()),
  );
});
