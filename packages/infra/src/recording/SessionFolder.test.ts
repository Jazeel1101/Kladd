import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ClipCapture,
  Clips,
  LoggingOverlay,
  RecordingStore,
  Recordings,
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
  RecordingSession,
  RecordingSessionId,
  TranscriptionFailed,
  renderOverview,
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
import { RecordingStoreFile } from "./RecordingStoreFile";

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

/** Recordings and Clips with the real file store in `dataDir`: what Kladd writes into a session folder. */
const kladdIn = (dataDir: string, transcriber: TranscriberLayer = TranscriberTest()) =>
  Recordings.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provide([ScreenCaptureTest.granted, IdsTest, FocusTrackerTest(), AppAdaptersTest()]),
    Layer.provideMerge(Clips.layer),
    Layer.provideMerge(
      Layer.mergeAll(SessionCaptureTest(), clipCapture, transcriber, OverlayWindowsTest),
    ),
    Layer.provideMerge(RecordingStoreFile),
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
 * `crashed`: the session and clip were still recording, so neither has a stop time.
 */
const leftUnfinished = Effect.fn("test.leftUnfinished")(function* (
  id: string,
  sound: boolean,
  crashed = false,
) {
  const store = yield* RecordingStore;
  const fs = yield* FileSystem.FileSystem;
  const folder = yield* store.save(
    new RecordingSession({ id: RecordingSessionId.make(id), startedAt }),
  );
  if (!crashed) yield* store.clear;
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
    stoppedAt: string | null;
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

/** Starts a session, runs `during` in its folder, stops it, and waits for its overview. */
const recordOnce = Effect.fn("test.recordOnce")(function* (
  during: (folder: string) => Effect.Effect<void, unknown, Clips> = () => Effect.void,
) {
  const recordings = yield* Recordings;
  yield* recordings.start;
  const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
  assert.isDefined(folder);
  yield* during(folder);
  yield* recordings.stop;
  yield* overviewOf(folder);
  return folder;
});

const toggle = Effect.gen(function* () {
  yield* (yield* Clips).toggle;
});

/** One clip, started and stopped. */
const clip = Effect.andThen(toggle, toggle);

describe("session folder", () => {
  it.live("after stop: stoppedAt is set and overview.md is written, without clips", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      const folder = yield* recordOnce();
      assert.strictEqual(yield* overviewOf(folder), renderOverview(yield* store.read(folder)));
      assert.isString((yield* readJson(`${folder}/session.json`)).stoppedAt);
      assert.deepStrictEqual(yield* transcribed, []);
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

  it.live("stopping the session stops its clip, which is then transcribed with the session", () =>
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

  it.live("a session a crash left recording a clip is finished at launch, the clip as it is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const left = yield* leftUnfinished("session-7", true, true).pipe(
        Effect.provide(kladdIn(dataDir)),
      );
      yield* Effect.gen(function* () {
        assert.isTrue(Option.isNone(yield* (yield* Recordings).active));
        assert.include(yield* overviewOf(left.folder), "No stop time for clip 001 (a crash)");
        assert.isNull((yield* readJson(`${left.folder}/session.json`)).stoppedAt);
        const info = yield* readJson(`${left.clip}/clip.json`);
        assert.isNull(info.stoppedAt);
        assert.strictEqual(info.language, "no");
        assert.isFalse(yield* fs.exists(`${dataDir}/active-recording.json`));
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
        assert.deepStrictEqual(yield* (yield* RecordingStore).unfinished, []);
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

  it.live("the active session's folder is not finished when the model gets ready", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const model = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const recordings = yield* Recordings;
        yield* recordings.start;
        const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
        assert.isDefined(folder);
        yield* clip;
        const audio = `${folder}/clips/001/audio.m4a`;
        yield* eventually(transcribed, (all) => all.length === 1);
        yield* Deferred.succeed(model, undefined);
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, [audio]);
        assert.isFalse(yield* fs.exists(`${folder}/overview.md`));
        yield* recordings.stop;
        assert.include(yield* overviewOf(folder, (t) => t.includes("1 lines")), "| 001 |");
        assert.deepStrictEqual(yield* transcribed, [audio, audio]);
      }).pipe(Effect.provide(kladdInTemp(whisper(model))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
