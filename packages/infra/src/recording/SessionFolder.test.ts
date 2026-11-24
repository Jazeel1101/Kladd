import * as NodeServices from "@effect/platform-node/NodeServices";
import { LoggingOverlay, RecordingStore, Recordings } from "@kladd/core";
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
import { DateTime, Effect, FileSystem, Layer, Option, Ref, Schedule } from "effect";
import { StorageConfig } from "../StorageConfig";
import { RecordingStoreFile } from "./RecordingStoreFile";

/** Recordings with the real file store in `dataDir`: what Kladd writes into a session folder. */
const kladdIn = (dataDir: string, transcriber = TranscriberTest()) =>
  Recordings.layer.pipe(
    Layer.provide(LoggingOverlay.layer),
    Layer.provide([ScreenCaptureTest.granted, IdsTest, FocusTrackerTest(), AppAdaptersTest()]),
    Layer.provideMerge(Layer.mergeAll(SessionCaptureTest(), transcriber, OverlayWindowsTest)),
    Layer.provideMerge(RecordingStoreFile),
    Layer.provide(Layer.succeed(StorageConfig, StorageConfig.of({ dataDir, appVersion: "1.2.3" }))),
  );

const kladdInTemp = (transcriber = TranscriberTest()) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return kladdIn(yield* fs.makeTempDirectoryScoped(), transcriber);
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

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
});
