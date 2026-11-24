import * as NodeServices from "@effect/platform-node/NodeServices";
import { LoggingOverlay, RecordingStore, Recordings, Transcriber } from "@kladd/core";
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
import { DateTime, Deferred, Effect, FileSystem, Layer, Option, Ref, Schedule } from "effect";
import { StorageConfig } from "../StorageConfig";
import { RecordingStoreFile } from "./RecordingStoreFile";

type TranscriberLayer = Layer.Layer<Transcriber | TranscriberLog, never, FileSystem.FileSystem>;

/** Recordings with the real file store in `dataDir`: what Kladd writes into a session folder. */
const kladdIn = (dataDir: string, transcriber: TranscriberLayer = TranscriberTest()) =>
  Recordings.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provide([ScreenCaptureTest.granted, IdsTest, FocusTrackerTest(), AppAdaptersTest()]),
    Layer.provideMerge(Layer.mergeAll(SessionCaptureTest(), transcriber, OverlayWindowsTest)),
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

/** A folder the last launch saved and stopped, with audio, but quit before finishing. */
const leftUnfinished = Effect.fn("test.leftUnfinished")(function* (id: string, audio: boolean) {
  const store = yield* RecordingStore;
  const folder = yield* store.save(
    new RecordingSession({
      id: RecordingSessionId.make(id),
      startedAt: DateTime.makeUnsafe("2026-11-24T13:02:00Z"),
    }),
  );
  yield* store.clear;
  if (audio) yield* writeAudio(folder);
  return folder;
});

const transcribed = Effect.gen(function* () {
  return (yield* Ref.get(yield* TranscriberLog)).transcribed;
});

const sessionJson = Effect.fn("test.sessionJson")(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  return JSON.parse(yield* fs.readFileString(`${folder}/session.json`)) as {
    stoppedAt: string | null;
    language: string | null;
  };
});

/** Waits for the background finish, which writes overview.md last. */
const overviewOf = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(`${folder}/overview.md`);
  }).pipe(Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 200 }));

/** Records once; `during` runs while recording, in the session folder. */
const recordOnce = Effect.fn("test.recordOnce")(function* (
  during: (folder: string) => Effect.Effect<void, unknown, FileSystem.FileSystem>,
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

const writeAudio = Effect.fn("test.writeAudio")(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(`${folder}/audio.m4a`, "");
});

describe("session folder", () => {
  it.live("after stop: stoppedAt is set and overview.md is written, without audio", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      const folder = yield* recordOnce(() => Effect.void);
      assert.strictEqual(yield* overviewOf(folder), renderOverview(yield* store.read(folder)));
      const info = yield* sessionJson(folder);
      assert.isString(info.stoppedAt);
      assert.isNull(info.language);
      assert.deepStrictEqual((yield* Ref.get(yield* TranscriberLog)).transcribed, []);
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live("with audio: transcribes it and stores the language in session.json", () =>
    Effect.gen(function* () {
      const folder = yield* recordOnce(writeAudio);
      assert.deepStrictEqual((yield* Ref.get(yield* TranscriberLog)).transcribed, [
        `${folder}/audio.m4a`,
      ]);
      assert.strictEqual((yield* sessionJson(folder)).language, "no");
    }).pipe(Effect.provide(kladdInTemp())),
  );

  it.live("a failed transcription still writes overview.md", () =>
    Effect.gen(function* () {
      const folder = yield* recordOnce(writeAudio);
      assert.isNull((yield* sessionJson(folder)).language);
    }).pipe(
      Effect.provide(kladdInTemp(TranscriberTest(new TranscriptionFailed({ reason: "no model" })))),
    ),
  );

  it.live("a recording a crash left active is finished at launch, not shown as recording", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      // The last launch started a recording and wrote half a timeline line, then died.
      const folder = yield* Effect.gen(function* () {
        const store = yield* RecordingStore;
        const created = yield* store.save(
          new RecordingSession({
            id: RecordingSessionId.make("session-7"),
            startedAt: DateTime.makeUnsafe("2026-11-24T13:02:00Z"),
          }),
        );
        yield* fs.writeFileString(`${created}/timeline.jsonl`, `{"type":"start","t":0,"at`);
        return created;
      }).pipe(Effect.provide(kladdIn(dataDir)));

      yield* Effect.gen(function* () {
        const recordings = yield* Recordings;
        assert.isTrue(Option.isNone(yield* recordings.active));
        yield* overviewOf(folder);
        // Nobody knows when it stopped.
        assert.isNull((yield* sessionJson(folder)).stoppedAt);
        assert.isFalse(yield* fs.exists(`${dataDir}/active-recording.json`));
      }).pipe(Effect.provide(kladdIn(dataDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a recording stopped before the model is ready is transcribed once it is", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const folder = yield* recordOnce(writeAudio);
        assert.notInclude(yield* overviewOf(folder), "hei");
        yield* Deferred.succeed(ready, undefined);
        const rewritten = yield* overviewOf(folder).pipe(
          Effect.filterOrFail((text) => text.includes("hei")),
          Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 200 }),
        );
        assert.include(rewritten, "hei");
        assert.strictEqual((yield* sessionJson(folder)).language, "no");
        assert.deepStrictEqual(yield* transcribed, [`${folder}/audio.m4a`, `${folder}/audio.m4a`]);
      }).pipe(Effect.provide(kladdInTemp(whisper(ready))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("folders a quit left without overview.md are finished on the next launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const [silent, spoken] = yield* Effect.all([
        leftUnfinished("session-7", false),
        leftUnfinished("session-8", true),
      ]).pipe(Effect.provide(kladdIn(dataDir, whisper(yield* Deferred.make<void>()))));

      const ready = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        // Without audio it needs no model.
        yield* overviewOf(silent);
        assert.isFalse(yield* fs.exists(`${spoken}/overview.md`));
        yield* Deferred.succeed(ready, undefined);
        assert.include(yield* overviewOf(spoken), "hei");
        assert.deepStrictEqual(yield* transcribed, [`${spoken}/audio.m4a`]);
      }).pipe(Effect.provide(kladdIn(dataDir, whisper(ready))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a finished folder, even of silence, is left alone on the next launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const ready = yield* Deferred.make<void>();
      yield* Deferred.succeed(ready, undefined);
      const folder = yield* recordOnce(writeAudio).pipe(
        Effect.provide(kladdIn(dataDir, whisper(ready, ""))),
      );
      assert.strictEqual(yield* fs.readFileString(`${folder}/transcript.jsonl`), "");

      yield* Effect.gen(function* () {
        assert.deepStrictEqual(yield* (yield* RecordingStore).unfinished, []);
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, []);
      }).pipe(Effect.provide(kladdIn(dataDir, whisper(ready, ""))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("a transcription that keeps failing is tried once per launch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataDir = yield* fs.makeTempDirectoryScoped();
      const folder = yield* leftUnfinished("session-7", true).pipe(
        Effect.provide(kladdIn(dataDir)),
      );
      const broken = TranscriberTest(new TranscriptionFailed({ reason: "bad audio" }));
      yield* Effect.gen(function* () {
        yield* overviewOf(folder);
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, [`${folder}/audio.m4a`]);
      }).pipe(Effect.provide(kladdIn(dataDir, broken)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("the active recording's folder is not finished when the model gets ready", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const ready = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const recordings = yield* Recordings;
        yield* recordings.start;
        const [folder] = (yield* Ref.get(yield* SessionCaptureLog)).started;
        assert.isDefined(folder);
        yield* writeAudio(folder);
        yield* Deferred.succeed(ready, undefined);
        yield* Effect.sleep("100 millis");
        assert.deepStrictEqual(yield* transcribed, []);
        assert.isFalse(yield* fs.exists(`${folder}/overview.md`));
        yield* recordings.stop;
        assert.include(yield* overviewOf(folder), "hei");
      }).pipe(Effect.provide(kladdInTemp(whisper(ready))));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
