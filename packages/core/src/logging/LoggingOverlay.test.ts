import { assert, describe, it } from "@effect/vitest";
import { FocusTrackingFailed, emptyFocus, makeAppAdapter, type FocusSnapshot } from "@kladd/domain";
import { Effect, Layer, Ref, Stream } from "effect";
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

const notesWithPage = makeAppAdapter({
  id: "notes-pages",
  bundleIds: ["com.apple.Notes"],
  anchor: (f) => f.window,
  target: (f) => ({ app: "Notes", document: f.title?.replace(" – Notes", "") ?? null }),
});

const provide = (focus: FocusSnapshot | FocusTrackingFailed, adapters = AppAdaptersTest()) =>
  Effect.provide(
    LoggingOverlay.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(FocusTrackerTest(focus), adapters, OverlayWindowsTest)),
    ),
  );

/** Opens the overlay, then returns what it told its UI. */
const openInfo = (focus: FocusSnapshot | FocusTrackingFailed, adapters = AppAdaptersTest()) =>
  Effect.gen(function* () {
    const overlay = yield* LoggingOverlay;
    yield* overlay.open;
    return yield* overlay.changes.pipe(Stream.runHead);
  }).pipe(provide(focus, adapters));

const run = (focus: FocusSnapshot, adapters = AppAdaptersTest()) =>
  Effect.gen(function* () {
    const overlay = yield* LoggingOverlay;
    yield* overlay.open;
    return yield* Ref.get(yield* OverlayWindowsLog);
  }).pipe(provide(focus, adapters));

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

  it.effect("tells the UI the adapter's writing target", () =>
    Effect.gen(function* () {
      const app = { bundleId: "com.apple.Notes", name: "Notes" };
      const window = { x: 400, y: 50, width: 600, height: 600 };
      const info = yield* openInfo(
        { ...emptyFocus, app, window, title: "Handleliste – Notes" },
        AppAdaptersTest([notesWithPage]),
      );
      assert.deepStrictEqual(info._tag === "Some" ? info.value : null, {
        target: { app: "Notes", document: "Handleliste" },
        adapter: "notes-pages",
        anchored: true,
      });
    }),
  );

  it.effect("opens at the no-anchor position when focus can't be read", () =>
    Effect.gen(function* () {
      const info = yield* openInfo(new FocusTrackingFailed({ reason: "no helper" }));
      assert.deepStrictEqual(info._tag === "Some" ? info.value : null, {
        target: { app: null, document: null },
        adapter: "test-fallback",
        anchored: false,
      });
    }),
  );
});
