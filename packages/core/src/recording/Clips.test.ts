import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
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
  SessionCaptureTest,
  TranscriberTest,
} from "../testing";
import { Clips } from "./Clips";
import { Recordings } from "./Recordings";

const kladd = Recordings.layer.pipe(
  Layer.provide([ScreenCaptureTest.granted, IdsTest]),
  Layer.provide(LoggingOverlay.layer),
  Layer.provideMerge(Clips.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      FocusTrackerTest(),
      AppAdaptersTest(),
      SessionCaptureTest(),
      TranscriberTest(),
      ClipCaptureTest,
      OverlayWindowsTest,
      RecordingStoreTest,
    ),
  ),
);

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
});
