import { assert, describe, it } from "@effect/vitest";
import { emptyFocus, makeAppAdapter, type FocusSnapshot } from "@kladd/domain";
import { Effect, Layer, Ref } from "effect";
import {
  AppAdaptersTest,
  FocusTrackerTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
} from "../testing";
import { LoggingOverlay } from "./LoggingOverlay";

const caret = { x: 100, y: 200, width: 1, height: 16 };
const notes = makeAppAdapter({
  id: "notes",
  bundleIds: ["com.apple.Notes"],
  anchor: (f) => f.window,
});

const run = (focus: FocusSnapshot, adapters = AppAdaptersTest()) =>
  Effect.gen(function* () {
    const overlay = yield* LoggingOverlay;
    yield* overlay.open;
    return yield* Ref.get(yield* OverlayWindowsLog);
  }).pipe(
    Effect.provide(
      LoggingOverlay.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(FocusTrackerTest(focus), adapters, OverlayWindowsTest)),
      ),
    ),
  );

describe("LoggingOverlay.open", () => {
  it.effect("places the overlay right of the anchor the fallback adapter picks", () =>
    Effect.gen(function* () {
      const shown = yield* run({ ...emptyFocus, caret });
      assert.deepStrictEqual(shown, [
        { kind: "logging", bounds: { x: 109, y: 200, width: 300, height: 400 } },
      ]);
    }),
  );

  it.effect("uses the front app's adapter", () =>
    Effect.gen(function* () {
      const window = { x: 400, y: 50, width: 600, height: 600 };
      const app = { bundleId: "com.apple.Notes", name: "Notes" };
      const shown = yield* run({ ...emptyFocus, app, window, caret }, AppAdaptersTest([notes]));
      assert.strictEqual(shown[0]?.bounds?.x, 1008);
    }),
  );

  it.effect("uses the no-anchor position when nothing is known", () =>
    Effect.gen(function* () {
      const shown = yield* run(emptyFocus);
      assert.deepStrictEqual(shown[0]?.bounds, { x: 1132, y: 250, width: 300, height: 400 });
    }),
  );
});
