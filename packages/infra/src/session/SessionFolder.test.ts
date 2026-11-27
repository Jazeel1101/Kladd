import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ClipCapture,
  Clips,
  LoggingOverlay,
  Screenshots,
  SessionStore,
  Sessions,
  SummaryAgent,
  Transcriber,
} from "@kladd/core";
import {
  AppAdaptersTest,
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsTest,
  ScreenCaptureTest,
  SessionCaptureLog,
  SessionCaptureTest,
  TranscriberLog,
  TranscriberTest,
} from "@kladd/core/testing";
import {
  Session,
  SessionId,
  TranscriptionFailed,
  renderOverview,
  sessionState,
} from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import {
  Context,
  DateTime,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Ref,
  Schedule,
} from "effect";
import { StorageConfig } from "../StorageConfig";
import { SessionStoreFile } from "./SessionStoreFile";

type TranscriberLayer = Layer.Layer<Transcriber | TranscriberLog, never, FileSystem.FileSystem>;

/** What clipCapture saw: the clip folders it started in, and how many it stopped. */
class ClipCaptureLog extends Context.Service<
  ClipCaptureLog,
  Ref.Ref<{ readonly started: ReadonlyArray<string>; readonly stopped: number }>
>()("kladd/infra/test/ClipCaptureLog") {}

/** ClipCapture as the helper runs it with the microphone allowed: writes `audio.m4a` at start. */
const clipCapture = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const log = yield* Ref.make<{ started: ReadonlyArray<string>; stopped: number }>({
      started: [],
      stopped: 0,
    });
    const stop = Ref.update(log, (l) => ({ ...l, stopped: l.stopped + 1 }));
    const capture = ClipCapture.of({
      start: (dir) =>
        fs
          .writeFileString(`${dir}/audio.m4a`, "")
          .pipe(
            Effect.orDie,
            Effect.andThen(Ref.update(log, (l) => ({ ...l, started: [...l.started, dir] }))),
            Effect.as({ stop }),
          ),
    });
    return Layer.mergeAll(Layer.succeed(ClipCapture, capture), Layer.succeed(ClipCaptureLog, log));
  }),
);

/** A summary agent that works: writes `summary.md` into the folder. */
const summaryAgent = Layer.effect(
  SummaryAgent,
  Effect.map(FileSystem.FileSystem, (fs) =>
    SummaryAgent.of({
      summarize: (folder) =>
        fs.writeFileString(`${folder}/summary.md`, "# Oppsummering\n").pipe(Effect.orDie),
    }),
  ),
);

/**
 * Sessions, Clips and Screenshots with the real file store in `dataDir`: what Kladd writes into a
 * session folder.
 */
const kladdIn = (dataDir: string, transcriber: TranscriberLayer = TranscriberTest()) =>
  Sessions.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provideMerge(Layer.mergeAll(Clips.layer, Screenshots.layer)),
    Layer.provide([
      ScreenCaptureTest.granted,
      IdsTest,
      FocusTrackerTest(),
      AppAdaptersTest(),
      summaryAgent,
    ]),
    Layer.provideMerge(
      Layer.mergeAll(SessionCaptureTest(), clipCapture, transcriber, OverlayWindowsTest),
    ),
    Layer.provideMerge(SessionStoreFile),
    Layer.provide(Layer.succeed(StorageConfig, StorageConfig.of({ dataDir, appVersion: "1.2.3" }))),
  );

const kladdInTemp = (transcriber: TranscriberLayer = TranscriberTest()) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return kladdIn(yield* fs.makeTempDirectoryScoped(), transcriber);
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * Whisper as kladd-transcribe runs it: no model until `ready` is done, then writes `speech` as one
 * segment, or an empty transcript for "". Logs in TranscriberLog.
 */
const whisper = (ready: Deferred.Deferred<void>, speech = "hei") =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const log = yield* Ref.make<{ prepared: number; transcribed: ReadonlyArray<string> }>({
        prepared: 0,
        transcribed: [],
      });
      const transcribe = Effect.fn("test.whisper.transcribe")(function* (
        audio: string,
        out: string,
      ) {
        yield* Ref.update(log, (l) => ({ ...l, transcribed: [...l.transcribed, audio] }));
        if (!(yield* Deferred.isDone(ready))) {
          return yield* new TranscriptionFailed({ reason: "model not downloaded yet" });
        }
        const line = speech === "" ? "" : `${JSON.stringify({ t: 0, end: 1, text: speech })}\n`;
        yield* fs.writeFileString(out, line).pipe(Effect.orDie);
        return "no";
      });
      return Layer.mergeAll(
        Layer.succeed(Transcriber, Transcriber.of({ prepare: Deferred.await(ready), transcribe })),
        Layer.succeed(TranscriberLog, log),
      );
    }),
  );

const ready = Effect.gen(function* () {
  const done = yield* Deferred.make<void>();
  yield* Deferred.succeed(done, undefined);
  return done;
});

const startedAt = DateTime.makeUnsafe("2026-11-24T13:02:00Z");

/**
 * A folder the last launch saved, with one clip that recorded sound, then quit before finishing.
 * `crashed`: the session and clip were still recording, so neither has an end.
 */
const leftUnfinished = Effect.fn("test.leftUnfinished")(function* (
  id: string,
  sound: boolean,
  crashed = false,
) {
  const store = yield* SessionStore;
  const fs = yield* FileSystem.FileSystem;
  // Started just now, so it isn't past its end when the next launch reads it.
  const now = yield* DateTime.now;
  const folder = yield* store.create(
    new Session({
      id: SessionId.make(id),
      mode: "manual",
      startedAt: now,
      endedAt: crashed ? null : now,
      loggedAt: null,
    }),
  );
  const clip = yield* store.createClip(folder, {
    startedAt,
    stoppedAt: crashed ? null : startedAt,
    language: null,
  });
  if (sound) yield* fs.writeFileString(`${clip}/audio.m4a`, "").pipe(Effect.orDie);
  return { folder, clip };
});

const transcribed = Effect.gen(function* () {
  return (yield* Ref.get(yield* TranscriberLog)).transcribed;
});

const readJson = Effect.fn("test.readJson")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return JSON.parse(yield* fs.readFileString(file)) as {
    endedAt?: string | null;
    stoppedAt?: string | null;
    language?: string | null;
  };
});

/** Retries `effect` until it succeeds and passes `ok`: background work finishes on its own time. */
const eventually = <A, E, R>(effect: Effect.Effect<A, E, R>, ok: (a: A) => boolean = () => true) =>
  effect.pipe(
    Effect.filterOrFail(ok),
    Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 200 }),
  );

/** Waits for the background finish, which writes overview.md last. */
const overviewOf = (folder: string, ok?: (text: string) => boolean) =>
  eventually(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.readFileString(`${folder}/overview.md`);
    }),
    ok,
  );

/** Starts a session, runs `during` in its folder, ends it, and waits for its overview. */
const recordOnce = Effect.fn("test.recordOnce")(function* (
  during: (folder: string) => Effect.Effect<void, unknown, Clips | Screenshots> = () => Effect.void,
) {
  const sessions = yield* Sessions;
  yield* sessions.start("manual");
  const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
  assert.isDefined(folder);
  yield* during(folder);
  yield* sessions.end;
  yield* overviewOf(folder);
  return folder;
});

const toggle = Effect.gen(function* () {
  yield* (yield* Clips).toggle;
});

/** One screenshot. */
const take = Effect.gen(function* () {
  yield* (yield* Screenshots).take;
});

/** One clip, started and stopped. */
const clip = Effect.andThen(toggle, toggle);

describe("session folder", () => {
  it.live("a session that ends holding nothing leaves no folder behind", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sessions = yield* Sessions;
      yield* sessions.start("manual");
      const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
      assert.isDefined(folder);
      assert.isTrue(yield* fs.exists(folder));
      yield* sessions.end;
      assert.isFalse(yield* fs.exists(folder));
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live("after end: endedAt is set and overview.md is written, without clips", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const folder = yield* recordOnce(() => take);
      assert.strictEqual(yield* overviewOf(folder), renderOverview(yield* store.read(folder)));
      assert.isString((yield* readJson(`${folder}/session.json`)).endedAt);
      assert.deepStrictEqual(yield* transcribed, []);
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live("screenshots are saved in the session folder and listed in its overview", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* recordOnce(() => Effect.andThen(take, take));
      const names = (yield* fs.readDirectory(`${folder}/screenshots`)).toSorted();
      assert.deepStrictEqual(names, [
        "00000000-0000-7000-8000-000000000001.json",
        "00000000-0000-7000-8000-000000000002.json",
      ]);
      const text = yield* overviewOf(folder);
      assert.include(text, "Manual session, started");
      assert.include(text, "Screenshots: 2. Clips: 0.");
      assert.include(text, "screenshots/00000000-0000-7000-8000-000000000002.png");
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live(
    "two clips in a session go to 001 and 002, are transcribed, and not quoted in the overview",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* recordOnce(() => Effect.andThen(clip, clip));
        const [first, second] = [`${folder}/clips/001`, `${folder}/clips/002`];
        assert.deepStrictEqual((yield* Ref.get(yield* ClipCaptureLog)).started, [first, second]);
        const text = yield* overviewOf(folder, (t) => !t.includes("| no | 0 |"));
        assert.deepStrictEqual(yield* transcribed, [`${first}/audio.m4a`, `${second}/audio.m4a`]);
        for (const dir of [first, second]) {
          assert.include(yield* fs.readFileString(`${dir}/transcript.jsonl`), "hemmelig");
          const info = yield* readJson(`${dir}/clip.json`);
          assert.strictEqual(info.language, "no");
          assert.isString(info.stoppedAt);
          assert.include(text, `| clips/${dir.slice(-3)}/ | yes | 1 lines | 0 |`);
        }
        assert.notInclude(text, "hemmelig");
      }).pipe(
        Effect.provide(kladdInTemp(Layer.unwrap(Effect.map(ready, (r) => whisper(r, "hemmelig"))))),
      ),
  );

  it.live("ending the session stops its clip, which is then transcribed with the session", () =>
    Effect.gen(function* () {
      const folder = yield* recordOnce(() => toggle);
      assert.strictEqual((yield* Ref.get(yield* ClipCaptureLog)).stopped, 1);
      const info = yield* readJson(`${folder}/clips/001/clip.json`);
      assert.isString(info.stoppedAt);
      assert.include(yield* overviewOf(folder), "| 001 |");
      assert.deepStrictEqual(yield* transcribed, [`${folder}/clips/001/audio.m4a`]);
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live("a failed transcription still writes overview.md", () =>
    Effect.gen(function* () {
      const folder = yield* recordOnce(() => clip);
      assert.include(yield* overviewOf(folder), "No transcript.jsonl yet in clip 001");
      assert.isNull((yield* readJson(`${folder}/clips/001/clip.json`)).language);
    }).pipe(
      Effect.provide(kladdInTemp(TranscriberTest(new TranscriptionFailed({ reason: "no model" })))),
    ),
  );

  it.live(
    "a clip stopped before the model is ready is transcribed once it is, and the overview rewritten",
    () =>
      Effect.gen(function* () {
        const model = yield* Deferred.make<void>();
        yield* Effect.gen(function* () {
          const folder = yield* recordOnce(() => clip);
          const audio = `${folder}/clips/001/audio.m4a`;
          assert.include(yield* overviewOf(folder), "| clips/001/ | yes | no | 0 |");
          yield* Deferred.succeed(model, undefined);
          const rewritten = yield* overviewOf(folder, (t) => t.includes("| yes | 1 lines |"));
          assert.notInclude(rewritten, "hei");
          assert.notInclude(rewritten, "No transcript.jsonl yet");
          assert.strictEqual((yield* readJson(`${folder}/clips/001/clip.json`)).language, "no");
          // At clip stop, at session stop, and once the model was ready.
          assert.deepStrictEqual(yield* transcribed, [audio, audio, audio]);
        }).pipe(Effect.provide(kladdInTemp(whisper(model))));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a session a crash left recording a clip is resumed at launch, the clip as it is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const left = yield* leftUnfinished("session-7", true, true).pipe(
        Effect.provide(kladdIn(dataDir)),
      );
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions;
        const resumed = Option.map(yield* sessions.current, sessionState);
        assert.deepStrictEqual(resumed, Option.some("active"));
        assert.deepStrictEqual((yield* Ref.get(yield* SessionCaptureLog)).started, [left.folder]);
        // Its stopped clips are transcribed once the model is ready; the cut-off one is too.
        yield* eventually(transcribed, (all) => all.length === 1);
        yield* sessions.end;
        assert.include(yield* overviewOf(left.folder), "No stop time for clip 001 (a crash)");
        assert.isString((yield* readJson(`${left.folder}/session.json`)).endedAt);
        const info = yield* readJson(`${left.clip}/clip.json`);
        assert.isNull(info.stoppedAt);
        assert.strictEqual(info.language, "no");
      }).pipe(Effect.provide(kladdIn(dataDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("folders a quit left unfinished are finished on the next launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const [silent, spoken] = yield* Effect.all([
        leftUnfinished("session-7", false),
        leftUnfinished("session-8", true),
      ]).pipe(Effect.provide(kladdIn(dataDir, whisper(yield* Deferred.make<void>()))));

      const model = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        // Without sound it needs no model.
        yield* overviewOf(silent.folder);
        assert.isFalse(yield* fs.exists(`${spoken.folder}/overview.md`));
        yield* Deferred.succeed(model, undefined);
        assert.include(yield* overviewOf(spoken.folder), "| yes | 1 lines |");
        assert.deepStrictEqual(yield* transcribed, [`${spoken.clip}/audio.m4a`]);
      }).pipe(Effect.provide(kladdIn(dataDir, whisper(model))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a finished folder, even of silence, is left alone on the next launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const model = yield* ready;
      const folder = yield* recordOnce(() => clip).pipe(
        Effect.provide(kladdIn(dataDir, whisper(model, ""))),
      );
      yield* eventually(fs.readFileString(`${folder}/clips/001/transcript.jsonl`));

      yield* Effect.gen(function* () {
        assert.isTrue(yield* (yield* SessionStore).finished(folder));
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, []);
      }).pipe(Effect.provide(kladdIn(dataDir, whisper(model, ""))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a transcription that keeps failing is tried once per launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const left = yield* leftUnfinished("session-7", true).pipe(Effect.provide(kladdIn(dataDir)));
      const broken = TranscriberTest(new TranscriptionFailed({ reason: "bad audio" }));
      yield* Effect.gen(function* () {
        yield* overviewOf(left.folder);
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, [`${left.clip}/audio.m4a`]);
      }).pipe(Effect.provide(kladdIn(dataDir, broken)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live(
    "when the model gets ready, the active session's stopped clips are transcribed, and its overview waits for its end",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const model = yield* Deferred.make<void>();
        yield* Effect.gen(function* () {
          const sessions = yield* Sessions;
          yield* sessions.start("manual");
          const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
          assert.isDefined(folder);
          yield* clip;
          const [first, second] = [`${folder}/clips/001`, `${folder}/clips/002`];
          yield* eventually(transcribed, (all) => all.length === 1);
          // 002 is still recording when the model gets ready.
          yield* toggle;
          yield* Deferred.succeed(model, undefined);
          yield* eventually(fs.readFileString(`${first}/transcript.jsonl`));
          assert.strictEqual((yield* readJson(`${first}/clip.json`)).language, "no");
          yield* Effect.sleep("100 millis");
          assert.deepStrictEqual(yield* transcribed, [`${first}/audio.m4a`, `${first}/audio.m4a`]);
          assert.isFalse(yield* fs.exists(`${second}/transcript.jsonl`));
          assert.isFalse(yield* fs.exists(`${folder}/overview.md`));
          yield* sessions.end;
          const text = yield* overviewOf(folder, (t) => !t.includes("| no | 0 |"));
          assert.include(text, "| clips/001/ | yes | 1 lines | 0 |");
          assert.include(text, "| clips/002/ | yes | 1 lines | 0 |");
          assert.deepStrictEqual(yield* transcribed, [
            `${first}/audio.m4a`,
            `${first}/audio.m4a`,
            `${second}/audio.m4a`,
          ]);
        }).pipe(Effect.provide(kladdInTemp(whisper(model))));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
