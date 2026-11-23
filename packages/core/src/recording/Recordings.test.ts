import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref } from "effect";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import type { ScreenCapture } from "../ports/ScreenCapture";
import {
  AppAdaptersTest,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
  RecordingStoreTest,
  ScreenCaptureTest,
} from "../testing";
import { Recordings } from "./Recordings";

const withCapture = (capture: Layer.Layer<ScreenCapture>) =>
  Recordings.layer.pipe(
    Layer.provide([capture, RecordingStoreTest, IdsTest]),
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Layer.mergeAll(FocusTrackerTest(), AppAdaptersTest(), OverlayWindowsTest)),
  );

describe("Recordings", () => {
  it.effect("start creates an active RecordingSession", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const session = yield* recordings.start;
      assert.strictEqual(session.id, "session-1");
      const active = yield* recordings.active;
      assert.deepStrictEqual(active, Option.some(session));
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );

  it.effect("start fails with RecordingAlreadyActive when a session is running", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      const error = yield* Effect.flip(recordings.start);
      assert.strictEqual(error._tag, "RecordingAlreadyActive");
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );

  it.effect("start fails and saves nothing when screen capture is denied", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const error = yield* Effect.flip(recordings.start);
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
      assert.isTrue(Option.isNone(yield* recordings.active));
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.denied))),
  );

  it.effect("stop ends the session and opens the logging overlay", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const session = yield* recordings.start;
      assert.deepStrictEqual(yield* recordings.stop, session);
      assert.isTrue(Option.isNone(yield* recordings.active));
      const shown = yield* Ref.get(yield* OverlayWindowsLog);
      assert.deepStrictEqual(
        shown.map((s) => s.kind),
        ["logging"],
      );
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );

  it.effect("stop fails with NoActiveRecording when nothing is recording", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const error = yield* Effect.flip(recordings.stop);
      assert.strictEqual(error._tag, "NoActiveRecording");
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );
});
