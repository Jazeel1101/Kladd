import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Stream } from "effect";
import { OverlayWindows } from "../ports/OverlayWindows";
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

const display = { x: 0, y: 0, width: 1440, height: 900 };

describe("Screenshots.take", () => {
  it.effect(
    "flies the screenshot from the whole display into the pill, not the logging overlay",
    () =>
      Effect.gen(function* () {
        const windows = yield* OverlayWindows;
        yield* windows.show("pill", { x: 8, y: 700, width: 132, height: 36 });
        const screenshots = yield* Screenshots;
        const screenshot = yield* screenshots.take;
        assert.deepStrictEqual((yield* tray)?.flying, {
          screenshot,
          from: display,
          to: { x: 45, y: 700, width: 58, height: 36 },
        });
        assert.deepStrictEqual(screenshot.display, display);
        const shown = yield* Ref.get(yield* OverlayWindowsLog);
        assert.deepStrictEqual(
          shown.map((s) => s.kind),
          ["pill", "flight"],
        );
        assert.deepStrictEqual(shown[1]?.bounds, display);
      }).pipe(withCapture()),
  );

  it.effect("shows the pill first if it is hidden", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      yield* screenshots.take;
      // The test pill opens at 0,0 (300x400).
      assert.deepStrictEqual((yield* tray)?.flying?.to, { x: -170, y: 0, width: 640, height: 400 });
      const shown = yield* Ref.get(yield* OverlayWindowsLog);
      assert.deepStrictEqual(
        shown.map((s) => s.kind),
        ["pill", "flight"],
      );
    }).pipe(withCapture()),
  );

  it.effect("lands a screenshot still flying, so the new one flies into the first slot", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const first = yield* screenshots.take;
      const second = yield* screenshots.take;
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
      const screenshots = yield* Screenshots;
      const error = yield* Effect.flip(screenshots.take);
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [] });
      assert.deepStrictEqual(yield* Ref.get(yield* OverlayWindowsLog), []);
    }).pipe(withCapture(ScreenCaptureTest.denied)),
  );

  it.effect("takes the screenshot once the user grants permission", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const screenshot = yield* screenshots.take;
      assert.strictEqual((yield* tray)?.flying?.screenshot.id, screenshot.id);
    }).pipe(withCapture(ScreenCaptureTest.grantedOnRequest)),
  );
});

describe("Screenshots.land", () => {
  it.effect("moves the screenshot in flight to the front of the tray", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      const first = yield* screenshots.take;
      yield* screenshots.land(first.id);
      const second = yield* screenshots.take;
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
      const first = yield* screenshots.take;
      const second = yield* screenshots.take;
      yield* screenshots.land(first.id);
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.strictEqual(now?.attached.length, 1);
    }).pipe(withCapture()),
  );
});
