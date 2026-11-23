import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { ScreenCapture } from "../ports/ScreenCapture";
import { IdsTest, RecordingStoreTest, ScreenCaptureTest } from "../testing";
import { Recordings } from "./Recordings";

const withCapture = (capture: Layer.Layer<ScreenCapture>) =>
  Recordings.layer.pipe(Layer.provide([capture, RecordingStoreTest, IdsTest]));

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
});
