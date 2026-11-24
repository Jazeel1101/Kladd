import { assert, describe, it } from "@effect/vitest";
import { ScreenCaptureFailed } from "@kladd/domain";
import { Effect, Layer, Option, Ref } from "effect";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import type { ScreenCapture } from "../ports/ScreenCapture";
import {
  AppAdaptersTest,
  ClipCaptureTest,
  FocusTrackerLog,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
  RecordingStoreTest,
  ScreenCaptureTest,
  SessionCaptureLog,
  SessionCaptureTest,
  TranscriberLog,
  TranscriberTest,
} from "../testing";
import { Clips } from "./Clips";
import { Recordings } from "./Recordings";

const withCapture = (
  capture: Layer.Layer<ScreenCapture>,
  focus: ReturnType<typeof FocusTrackerTest> = FocusTrackerTest(),
  session: ReturnType<typeof SessionCaptureTest> = SessionCaptureTest(),
) =>
  Recordings.layer.pipe(
    Layer.provide([capture, IdsTest]),
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Clips.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        focus,
        AppAdaptersTest(),
        OverlayWindowsTest,
        session,
        TranscriberTest(),
        ClipCaptureTest(),
        RecordingStoreTest,
      ),
    ),
  );

const broken = new ScreenCaptureFailed({ reason: "helper crashed" });

/** Accessibility is missing, and the user leaves its prompt open. */
const promptLeftOpen = FocusTrackerTest(undefined, {
  before: "denied",
  after: "denied",
  answer: Effect.never,
});

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

  it.effect("start asks for Accessibility in the background, without waiting for it", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      assert.isTrue(Option.isSome(yield* recordings.active));
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* FocusTrackerLog)).permissionRequests, 1);
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted, promptLeftOpen))),
  );

  it.effect("start shows one Accessibility prompt at a time", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      yield* Effect.yieldNow;
      yield* recordings.stop;
      yield* recordings.start;
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* FocusTrackerLog)).permissionRequests, 1);
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted, promptLeftOpen))),
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

  it.effect("concurrent starts create one session", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const results = yield* Effect.all([recordings.start, recordings.start], {
        concurrency: "unbounded",
        mode: "result",
      });
      assert.deepStrictEqual(
        results.map((result) => result._tag),
        ["Success", "Failure"],
      );
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.slow))),
  );

  it.effect("a stop that overlaps another stop leaves a newer session alone", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      const stops = yield* Effect.all([recordings.stop, recordings.stop], {
        concurrency: "unbounded",
        mode: "result",
      });
      assert.deepStrictEqual(
        stops.map((result) => result._tag),
        ["Success", "Failure"],
      );
      const next = yield* recordings.start;
      assert.deepStrictEqual(yield* recordings.active, Option.some(next));
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.slow))),
  );

  it.effect("stop fails with NoActiveRecording when nothing is recording", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const error = yield* Effect.flip(recordings.stop);
      assert.strictEqual(error._tag, "NoActiveRecording");
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );

  it.effect("start captures into the session folder, and stop stops it", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      yield* recordings.start;
      yield* recordings.stop;
      assert.deepStrictEqual(yield* Ref.get(yield* SessionCaptureLog), {
        started: ["/recordings/session-1"],
        stopped: 1,
      });
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );

  it.effect("start fails and leaves nothing recording when the capture can't start", () =>
    Effect.gen(function* () {
      const recordings = yield* Recordings;
      const error = yield* Effect.flip(recordings.start);
      assert.strictEqual(error._tag, "ScreenCaptureFailed");
      assert.isTrue(Option.isNone(yield* recordings.active));
      // The next start gets a new session instead of RecordingAlreadyActive.
      const retry = yield* Effect.flip(recordings.start);
      assert.strictEqual(retry._tag, "ScreenCaptureFailed");
    }).pipe(
      Effect.provide(
        withCapture(ScreenCaptureTest.granted, undefined, SessionCaptureTest({ start: broken })),
      ),
    ),
  );

  it.effect("stop still stops and opens the logging overlay when the capture fails to stop", () =>
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
    }).pipe(
      Effect.provide(
        withCapture(ScreenCaptureTest.granted, undefined, SessionCaptureTest({ stop: broken })),
      ),
    ),
  );

  it.effect("prepares transcription in the background when it starts", () =>
    Effect.gen(function* () {
      yield* Recordings;
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* TranscriberLog)).prepared, 1);
    }).pipe(Effect.provide(withCapture(ScreenCaptureTest.granted))),
  );
});
