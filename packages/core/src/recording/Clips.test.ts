import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import { RecordingStore } from "../ports/RecordingStore";
import {
  AppAdaptersTest,
  ClipCaptureTest,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsTest,
  RecordingStoreTest,
  ScreenCaptureTest,
  SessionCaptureLog,
  SessionCaptureTest,
  TranscriberTest,
} from "../testing";
import { Clips } from "./Clips";
import { Recordings } from "./Recordings";

const kladdWith = (capture: ReturnType<typeof ClipCaptureTest>) =>
  Recordings.layer.pipe(
    Layer.provide([ScreenCaptureTest.granted, IdsTest]),
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Clips.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        FocusTrackerTest(),
        AppAdaptersTest(),
        SessionCaptureTest(),
        TranscriberTest(),
        capture,
        OverlayWindowsTest,
        RecordingStoreTest,
      ),
    ),
  );

const kladd = kladdWith(ClipCaptureTest());

/** The clips of session-1's folder: name, and whether it stopped. */
const clipsOfFirstSession = Effect.gen(function* () {
  const { clips } = yield* (yield* RecordingStore).read("/recordings/session-1");
  return clips.map((clip) => [clip.name, clip.info.stoppedAt !== null] as const);
});

describe("Clips", () => {
  it.effect("toggle does nothing without a work session", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      yield* clips.toggle;
      yield* (yield* Recordings).start;
      assert.deepStrictEqual(yield* clipsOfFirstSession, []);
    }).pipe(Effect.provide(kladd)),
  );

  it.effect("toggles clips 001 and 002 in one session", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      yield* (yield* Recordings).start;
      yield* clips.toggle;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", false]]);
      yield* clips.toggle;
      yield* clips.toggle;
      yield* clips.toggle;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [
        ["001", true],
        ["002", true],
      ]);
    }).pipe(Effect.provide(kladd)),
  );

  it.effect("stopping the session stops its clip, and no clip starts after it", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      const recordings = yield* Recordings;
      yield* recordings.start;
      yield* clips.toggle;
      yield* recordings.stop;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", true]]);
      yield* clips.toggle;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", true]]);
    }).pipe(Effect.provide(kladd)),
  );

  it.effect("stopping the session interrupts a clip that never reports ready, and stops", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      const starting = yield* Effect.forkChild((yield* Clips).toggle);
      while ((yield* clipsOfFirstSession).length === 0) yield* Effect.yieldNow;
      yield* recordings.stop;
      yield* Fiber.join(starting);
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", true]]);
      assert.strictEqual((yield* Ref.get(yield* SessionCaptureLog)).stopped, 1);
      assert.isTrue(Option.isNone(yield* (yield* RecordingStore).active));
    }).pipe(Effect.provide(kladdWith(ClipCaptureTest({ start: Effect.never })))),
  );

  it.effect("a clip starts when its capture is ready, and stops when stop is asked for", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      const begun = yield* DateTime.now;
      yield* (yield* Recordings).start;
      const starting = yield* Effect.forkChild(clips.toggle);
      yield* TestClock.adjust("2 seconds");
      yield* Fiber.join(starting);
      yield* TestClock.adjust("5 seconds");
      const stopping = yield* Effect.forkChild(clips.toggle);
      yield* TestClock.adjust("3 seconds");
      yield* Fiber.join(stopping);
      const {
        clips: [clip],
      } = yield* (yield* RecordingStore).read("/recordings/session-1");
      assert.isDefined(clip);
      const at = (seconds: number) => DateTime.add(begun, { seconds });
      assert.deepStrictEqual(clip.info.startedAt, at(2));
      assert.deepStrictEqual(clip.info.stoppedAt, at(7));
    }).pipe(
      Effect.provide(
        kladdWith(
          ClipCaptureTest({ start: Effect.sleep("2 seconds"), stop: Effect.sleep("3 seconds") }),
        ),
      ),
    ),
  );
});
