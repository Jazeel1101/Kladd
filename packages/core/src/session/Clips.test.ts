import { assert, describe, it } from "@effect/vitest";
import { ScreenCaptureFailed } from "@kladd/domain";
import { DateTime, Effect, Fiber, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import { SessionStore } from "../ports/SessionStore";
import { Screenshots } from "../screenshot/Screenshots";
import {
  AppAdaptersTest,
  ClipCaptureTest,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsTest,
  ScreenCaptureTest,
  SessionCaptureLog,
  SessionCaptureTest,
  SessionStoreTest,
  SummaryAgentTest,
  TranscriberTest,
} from "../testing";
import { Clips } from "./Clips";
import { Sessions } from "./Sessions";

const kladdWith = (capture: ReturnType<typeof ClipCaptureTest>) =>
  Sessions.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Layer.mergeAll(Clips.layer, Screenshots.layer)),
    Layer.provideMerge(
      Layer.mergeAll(
        ScreenCaptureTest.granted,
        IdsTest,
        FocusTrackerTest(),
        AppAdaptersTest(),
        SessionCaptureTest(),
        TranscriberTest(),
        SummaryAgentTest(),
        capture,
        OverlayWindowsTest,
        SessionStoreTest(),
      ),
    ),
  );

const kladd = kladdWith(ClipCaptureTest());

/** The clips of session-1's folder: name, and whether it stopped. */
const clipsOfFirstSession = Effect.gen(function* () {
  const { clips } = yield* (yield* SessionStore).read("/sessions/session-1");
  return clips.map((clip) => [clip.name, clip.info.stoppedAt !== null] as const);
});

describe("Clips", () => {
  it.effect("toggle does nothing without a work session", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      yield* clips.toggle;
      yield* (yield* Sessions).start("manual");
      assert.deepStrictEqual(yield* clipsOfFirstSession, []);
    }).pipe(Effect.provide(kladd)),
  );

  it.effect("toggles clips 001 and 002 in one session", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      yield* (yield* Sessions).start("manual");
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
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* clips.toggle;
      yield* sessions.end;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", true]]);
      yield* clips.toggle;
      assert.deepStrictEqual(yield* clipsOfFirstSession, [["001", true]]);
    }).pipe(Effect.provide(kladd)),
  );

  it.effect("stopping the session cancels a clip that never reports ready, and stops", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const clips = yield* Clips;
      yield* sessions.start("manual");
      const starting = yield* Effect.forkChild(clips.toggle);
      while ((yield* clipsOfFirstSession).length === 0) yield* Effect.yieldNow;
      // A second press waits behind the start; once the session ends it leaves no clip either.
      const queued = yield* Effect.forkChild(clips.toggle);
      yield* sessions.end;
      yield* Fiber.join(starting);
      yield* Fiber.join(queued);
      assert.strictEqual((yield* Ref.get(yield* SessionCaptureLog)).stopped, 1);
      // The clip never recorded, so the session holds nothing and is discarded, folder and all.
      assert.isTrue(Option.isNone(yield* (yield* Sessions).current));
      assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
    }).pipe(Effect.provide(kladdWith(ClipCaptureTest({ start: Effect.never })))),
  );

  it.effect("a clip whose capture fails to start leaves no folder behind", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      yield* (yield* Sessions).start("manual");
      const failed = yield* Effect.flip(clips.toggle);
      assert.strictEqual(failed._tag, "ScreenCaptureFailed");
      assert.deepStrictEqual(yield* clipsOfFirstSession, []);
    }).pipe(
      Effect.provide(
        kladdWith(
          ClipCaptureTest({ start: Effect.fail(new ScreenCaptureFailed({ reason: "no frame" })) }),
        ),
      ),
    ),
  );

  it.effect("a clip starts when its capture is ready, and stops when stop is asked for", () =>
    Effect.gen(function* () {
      const clips = yield* Clips;
      const begun = yield* DateTime.now;
      yield* (yield* Sessions).start("manual");
      const starting = yield* Effect.forkChild(clips.toggle);
      yield* TestClock.adjust("2 seconds");
      yield* Fiber.join(starting);
      yield* TestClock.adjust("5 seconds");
      const stopping = yield* Effect.forkChild(clips.toggle);
      yield* TestClock.adjust("3 seconds");
      yield* Fiber.join(stopping);
      const {
        clips: [clip],
      } = yield* (yield* SessionStore).read("/sessions/session-1");
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
