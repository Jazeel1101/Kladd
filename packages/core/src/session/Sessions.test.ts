import { assert, describe, it } from "@effect/vitest";
import {
  ScreenCaptureFailed,
  ScreenshotId,
  type ScreenshotInfo,
  Session,
  SessionId,
  SummaryFailed,
  sessionState,
} from "@kladd/domain";
import { DateTime, Effect, Layer, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import type { ScreenCapture } from "../ports/ScreenCapture";
import { SessionStore } from "../ports/SessionStore";
import { Screenshots } from "../screenshot/Screenshots";
import {
  AppAdaptersTest,
  ClipCaptureTest,
  FocusTrackerLog,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
  ScreenCaptureTest,
  SessionCaptureLog,
  SessionCaptureTest,
  SessionStoreTest,
  SummaryAgentLog,
  SummaryAgentTest,
  TranscriberLog,
  TranscriberTest,
} from "../testing";
import { Clips } from "./Clips";
import { Sessions } from "./Sessions";

const kladd = (
  options: {
    readonly capture?: Layer.Layer<ScreenCapture>;
    readonly focus?: ReturnType<typeof FocusTrackerTest>;
    readonly session?: ReturnType<typeof SessionCaptureTest>;
    /** What earlier launches left in the store, oldest first, and their screenshots. */
    readonly stored?: ReadonlyArray<Session>;
    readonly screenshots?: ReadonlyArray<ScreenshotInfo>;
    readonly summary?: ReturnType<typeof SummaryAgentTest>;
    /** The `summary.md` the store reports for each session id. */
    readonly summaries?: Readonly<Record<string, string>>;
  } = {},
) =>
  Sessions.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Layer.mergeAll(Clips.layer, Screenshots.layer)),
    Layer.provideMerge(
      Layer.mergeAll(
        options.capture ?? ScreenCaptureTest.granted,
        IdsTest,
        options.focus ?? FocusTrackerTest(),
        AppAdaptersTest(),
        OverlayWindowsTest,
        options.session ?? SessionCaptureTest(),
        TranscriberTest(),
        options.summary ?? SummaryAgentTest(),
        ClipCaptureTest(),
        SessionStoreTest(options.stored, options.screenshots, options.summaries),
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

const shownWindows = Effect.gen(function* () {
  return (yield* Ref.get(yield* OverlayWindowsLog)).map((s) => (s.hidden ? `-${s.kind}` : s.kind));
});

const state = Effect.gen(function* () {
  return Option.map(yield* (yield* Sessions).current, sessionState);
});

const stored = (id: string, fields: Partial<Session> = {}) =>
  new Session({
    id: SessionId.make(id),
    mode: "manual",
    startedAt: DateTime.makeUnsafe(0),
    endedAt: null,
    loggedAt: null,
    ...fields,
  });

/** One screenshot into the active session, so it isn't discarded when it ends. */
const shoot = Effect.gen(function* () {
  yield* (yield* Screenshots).take;
});

/** A screenshot an earlier launch saved in session `id`, at its start. */
const shotIn = (id: string): ScreenshotInfo => ({
  id: ScreenshotId.make("00000000-0000-7000-8000-0000000000aa"),
  session: SessionId.make(id),
  takenAt: DateTime.makeUnsafe(0),
  display: { x: 0, y: 0, width: 1440, height: 900 },
  focus: null,
});

describe("Sessions", () => {
  it.effect("start opens an active session and captures into its folder in its mode", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const session = yield* sessions.start("manual");
      assert.strictEqual(session.id, "session-1");
      assert.strictEqual(session.mode, "manual");
      assert.deepStrictEqual(yield* sessions.current, Option.some(session));
      const log = yield* Ref.get(yield* SessionCaptureLog);
      assert.deepStrictEqual(log.started, ["/sessions/session-1"]);
      assert.deepStrictEqual(log.modes, ["manual"]);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("start fails with SessionAlreadyOpen while a session is active or being logged", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      assert.strictEqual((yield* Effect.flip(sessions.start("manual")))._tag, "SessionAlreadyOpen");
      yield* shoot;
      yield* sessions.end;
      assert.strictEqual((yield* Effect.flip(sessions.start("manual")))._tag, "SessionAlreadyOpen");
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("start fails and opens nothing when screen capture is denied", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const error = yield* Effect.flip(sessions.start("manual"));
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
      assert.isTrue(Option.isNone(yield* sessions.current));
    }).pipe(Effect.provide(kladd({ capture: ScreenCaptureTest.denied }))),
  );

  it.effect("start asks for Accessibility in the background, without waiting for it", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      assert.isTrue(Option.isSome(yield* sessions.current));
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* FocusTrackerLog)).permissionRequests, 1);
    }).pipe(Effect.provide(kladd({ focus: promptLeftOpen }))),
  );

  it.effect("start shows one Accessibility prompt at a time", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* Effect.yieldNow;
      yield* shoot;
      yield* sessions.end;
      yield* sessions.finishLogging;
      yield* sessions.start("manual");
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* FocusTrackerLog)).permissionRequests, 1);
    }).pipe(Effect.provide(kladd({ focus: promptLeftOpen }))),
  );

  it.effect("end stops the capture, saves the end and opens the logging overlay", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* shoot;
      yield* TestClock.adjust("30 minutes");
      const ended = Option.getOrThrow(yield* sessions.end);
      assert.deepStrictEqual(ended.endedAt, DateTime.makeUnsafe(30 * 60 * 1000));
      assert.deepStrictEqual(yield* state, Option.some("ended"));
      assert.strictEqual((yield* Ref.get(yield* SessionCaptureLog)).stopped, 1);
      const [saved] = yield* (yield* SessionStore).list;
      assert.deepStrictEqual(saved?.session, ended);
      assert.deepStrictEqual(yield* shownWindows, ["logging"]);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("end summarizes the folder once its overview is written", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const store = yield* SessionStore;
      // Let launch's check for unfinished folders run first, as it does in Kladd.
      yield* TestClock.adjust("1 second");
      yield* sessions.start("manual");
      yield* shoot;
      yield* sessions.end;
      yield* TestClock.adjust("1 second");
      const [saved] = yield* store.list;
      assert.isTrue(yield* store.finished(saved?.folder ?? ""));
      assert.deepStrictEqual(yield* Ref.get(yield* SummaryAgentLog), ["/sessions/session-1"]);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("a logged session left unfinished gets its overview at launch, but no summary", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("1 second");
      assert.isTrue(yield* (yield* SessionStore).finished("/sessions/old"));
      assert.deepStrictEqual(yield* Ref.get(yield* SummaryAgentLog), []);
    }).pipe(
      Effect.provide(
        kladd({
          stored: [
            stored("old", {
              endedAt: DateTime.makeUnsafe(1000),
              loggedAt: DateTime.makeUnsafe(2000),
            }),
          ],
        }),
      ),
    ),
  );

  it.effect("a failed summary still leaves the session ended and its overview written", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const store = yield* SessionStore;
      yield* sessions.start("manual");
      yield* shoot;
      yield* sessions.end;
      yield* TestClock.adjust("1 second");
      const [saved] = yield* store.list;
      assert.isTrue(yield* store.finished(saved?.folder ?? ""));
      assert.deepStrictEqual(yield* state, Option.some("ended"));
    }).pipe(
      Effect.provide(
        kladd({ summary: SummaryAgentTest(new SummaryFailed({ reason: "claude is missing" })) }),
      ),
    ),
  );

  it.effect(
    "the summary is being written once the session ends, then written from summary.md",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions;
        assert.isNull(Option.getOrNull(yield* Stream.runHead(sessions.summary)));
        yield* sessions.start("manual");
        yield* shoot;
        yield* sessions.end;
        yield* TestClock.adjust("1 second");
        assert.deepStrictEqual(Option.getOrNull(yield* Stream.runHead(sessions.summary)), {
          _tag: "Written",
          text: "# Økt",
        });
        yield* sessions.finishLogging;
        assert.isNull(Option.getOrNull(yield* Stream.runHead(sessions.summary)));
      }).pipe(Effect.provide(kladd({ summaries: { "session-1": "# Økt" } }))),
  );

  it.effect("the summary failed when finishing leaves no summary.md", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* shoot;
      yield* sessions.end;
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(Option.getOrNull(yield* Stream.runHead(sessions.summary)), {
        _tag: "Failed",
      });
    }).pipe(
      Effect.provide(
        kladd({ summary: SummaryAgentTest(new SummaryFailed({ reason: "claude is missing" })) }),
      ),
    ),
  );

  it.effect("finishLogging marks the session logged, closes the overlay and allows a new one", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* shoot;
      yield* sessions.end;
      const logged = yield* sessions.finishLogging;
      assert.strictEqual(sessionState(logged), "logged");
      assert.isTrue(Option.isNone(yield* sessions.current));
      assert.deepStrictEqual(yield* shownWindows, ["logging", "-logging"]);
      const next = yield* sessions.start("manual");
      assert.strictEqual(next.id, "session-2");
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("end and finishLogging fail when there is nothing to end or log", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      assert.strictEqual((yield* Effect.flip(sessions.end))._tag, "NoActiveSession");
      assert.strictEqual((yield* Effect.flip(sessions.finishLogging))._tag, "NoEndedSession");
      yield* sessions.start("manual");
      assert.strictEqual((yield* Effect.flip(sessions.finishLogging))._tag, "NoEndedSession");
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("concurrent starts open one session", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      const results = yield* Effect.all([sessions.start("manual"), sessions.start("manual")], {
        concurrency: "unbounded",
        mode: "result",
      });
      assert.deepStrictEqual(
        results.map((result) => result._tag),
        ["Success", "Failure"],
      );
    }).pipe(Effect.provide(kladd({ capture: ScreenCaptureTest.slow }))),
  );

  it.effect("overlapping ends end the session once", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      const ends = yield* Effect.all([sessions.end, sessions.end], {
        concurrency: "unbounded",
        mode: "result",
      });
      assert.deepStrictEqual(
        ends.map((result) => result._tag),
        ["Success", "Failure"],
      );
    }).pipe(Effect.provide(kladd({ capture: ScreenCaptureTest.slow }))),
  );

  it.effect("start fails and leaves no session behind when the capture can't start", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      assert.strictEqual(
        (yield* Effect.flip(sessions.start("manual")))._tag,
        "ScreenCaptureFailed",
      );
      assert.isTrue(Option.isNone(yield* sessions.current));
      assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
      // The next start gets a new session instead of SessionAlreadyOpen.
      assert.strictEqual(
        (yield* Effect.flip(sessions.start("manual")))._tag,
        "ScreenCaptureFailed",
      );
    }).pipe(Effect.provide(kladd({ session: SessionCaptureTest({ start: broken }) }))),
  );

  it.effect("end still ends and opens the logging overlay when the capture fails to stop", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* shoot;
      yield* sessions.end;
      assert.deepStrictEqual(yield* state, Option.some("ended"));
      assert.deepStrictEqual(yield* shownWindows, ["logging"]);
    }).pipe(Effect.provide(kladd({ session: SessionCaptureTest({ stop: broken }) }))),
  );

  it.effect("a session that ends holding nothing is discarded: no folder, no logging mode", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      assert.isTrue(Option.isNone(yield* sessions.end));
      assert.isTrue(Option.isNone(yield* sessions.current));
      assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
      assert.deepStrictEqual(yield* shownWindows, []);
      assert.strictEqual((yield* Ref.get(yield* SessionCaptureLog)).stopped, 1);
      assert.strictEqual((yield* sessions.start("manual")).id, "session-2");
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("a clip alone is enough to keep a session", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* Effect.andThen((yield* Clips).toggle, (yield* Clips).toggle);
      yield* sessions.end;
      assert.deepStrictEqual(yield* state, Option.some("ended"));
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("a session that ends by itself holding nothing is discarded too", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* TestClock.adjust("8 hours");
      assert.isTrue(Option.isNone(yield* sessions.current));
      assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("a session ends by itself 8 hours after its start, without the overlay", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* shoot;
      yield* TestClock.adjust("479 minutes");
      assert.deepStrictEqual(yield* state, Option.some("active"));
      yield* TestClock.adjust("1 minute");
      const ended = Option.getOrThrow(yield* sessions.current);
      assert.deepStrictEqual(ended.endedAt, DateTime.makeUnsafe(8 * 3600 * 1000));
      assert.deepStrictEqual(yield* shownWindows, []);
      assert.strictEqual((yield* Ref.get(yield* SessionCaptureLog)).stopped, 1);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("a capture late in the session keeps it open until an hour after it", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* TestClock.adjust("450 minutes");
      yield* (yield* Screenshots).take;
      yield* TestClock.adjust("59 minutes");
      assert.deepStrictEqual(yield* state, Option.some("active"));
      yield* TestClock.adjust("1 minute");
      const ended = Option.getOrThrow(yield* sessions.current);
      assert.deepStrictEqual(ended.endedAt, DateTime.makeUnsafe(8.5 * 3600 * 1000));
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("an active manual session from the last launch is resumed", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      assert.deepStrictEqual(yield* state, Option.some("active"));
      const log = yield* Ref.get(yield* SessionCaptureLog);
      assert.deepStrictEqual(log.started, ["/sessions/left"]);
      // It still ends by itself.
      yield* TestClock.adjust("8 hours");
      assert.deepStrictEqual(yield* state, Option.some("ended"));
      yield* sessions.finishLogging;
    }).pipe(Effect.provide(kladd({ stored: [stored("left")], screenshots: [shotIn("left")] }))),
  );

  it.effect("a session past its end at launch ends then, at its end, in logging mode", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("20 hours");
      yield* Effect.gen(function* () {
        const ended = Option.getOrThrow(yield* (yield* Sessions).current);
        assert.deepStrictEqual(ended.endedAt, DateTime.makeUnsafe(8 * 3600 * 1000));
        assert.deepStrictEqual((yield* Ref.get(yield* SessionCaptureLog)).started, []);
        assert.deepStrictEqual(yield* shownWindows, []);
      }).pipe(Effect.provide(kladd({ stored: [stored("left")], screenshots: [shotIn("left")] })));
    }),
  );

  it.effect("an empty session past its end at launch is discarded", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust("20 hours");
      yield* Effect.gen(function* () {
        assert.isTrue(Option.isNone(yield* (yield* Sessions).current));
        assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
      }).pipe(Effect.provide(kladd({ stored: [stored("left")] })));
    }),
  );

  it.effect("an auto session from the last launch ends instead of resuming", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* state, Option.some("ended"));
      assert.deepStrictEqual((yield* Ref.get(yield* SessionCaptureLog)).started, []);
    }).pipe(
      Effect.provide(
        kladd({ stored: [stored("left", { mode: "auto" })], screenshots: [shotIn("left")] }),
      ),
    ),
  );

  it.effect("a session ended in the last launch opens in logging mode", () =>
    Effect.gen(function* () {
      const ended = stored("left", { endedAt: DateTime.makeUnsafe(1000) });
      assert.deepStrictEqual(yield* (yield* Sessions).current, Option.some(ended));
    }).pipe(
      Effect.provide(
        kladd({
          stored: [
            stored("older", {
              endedAt: DateTime.makeUnsafe(10),
              loggedAt: DateTime.makeUnsafe(20),
            }),
            stored("left", { endedAt: DateTime.makeUnsafe(1000) }),
          ],
        }),
      ),
    ),
  );

  it.effect("past lists the sessions that are not active, newest first, with their captures", () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      yield* (yield* Screenshots).take;
      yield* Effect.andThen((yield* Clips).toggle, (yield* Clips).toggle);
      yield* sessions.end;
      const past = Option.getOrThrow(yield* Stream.runHead(sessions.past));
      assert.deepStrictEqual(
        past.map((p) => [p.session.id, p.screenshots.length, p.clips]),
        [
          ["session-1", 1, 1],
          ["older", 0, 0],
        ],
      );
    }).pipe(
      Effect.provide(
        kladd({
          stored: [
            stored("older", { endedAt: DateTime.makeUnsafe(1), loggedAt: DateTime.makeUnsafe(2) }),
          ],
        }),
      ),
    ),
  );

  it.effect("prepares transcription in the background when it starts", () =>
    Effect.gen(function* () {
      yield* Sessions;
      yield* Effect.yieldNow;
      assert.strictEqual((yield* Ref.get(yield* TranscriberLog)).prepared, 1);
    }).pipe(Effect.provide(kladd())),
  );
});
