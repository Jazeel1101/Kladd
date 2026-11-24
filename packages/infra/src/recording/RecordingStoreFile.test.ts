import * as NodeServices from "@effect/platform-node/NodeServices";
import { RecordingStore } from "@kladd/core";
import {
  RecordingSession,
  RecordingSessionId,
  type TimelineEvent,
  sessionFolderName,
} from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, Option, Path } from "effect";
import { StorageConfig } from "../StorageConfig";
import { RecordingStoreFile } from "./RecordingStoreFile";

const inTempDir = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataDir = yield* fs.makeTempDirectoryScoped();
    return RecordingStoreFile.pipe(
      Layer.provide(
        Layer.succeed(StorageConfig, StorageConfig.of({ dataDir, appVersion: "1.2.3" })),
      ),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("RecordingStoreFile", () => {
  it.effect("returns none when nothing was saved", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      assert.isTrue(Option.isNone(yield* store.active));
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("reads back the session it saved", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      const session = new RecordingSession({
        id: RecordingSessionId.make("session-1"),
        startedAt: DateTime.makeUnsafe("2026-01-01T10:00:00Z"),
      });
      yield* store.save(session);
      assert.deepStrictEqual(yield* store.active, Option.some(session));
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("returns none after clear", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      yield* store.save(
        new RecordingSession({
          id: RecordingSessionId.make("session-1"),
          startedAt: DateTime.makeUnsafe("2026-01-01T10:00:00Z"),
        }),
      );
      yield* store.clear;
      assert.isTrue(Option.isNone(yield* store.active));
    }).pipe(Effect.provide(inTempDir)),
  );
});

const session = new RecordingSession({
  id: RecordingSessionId.make("session-1"),
  startedAt: DateTime.makeUnsafe("2026-11-24T13:02:00Z"),
});

describe("RecordingStoreFile session folder", () => {
  it.effect("save creates the folder, named after the local start time, with session.json", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* store.save(session);
      const local = DateTime.setZone(session.startedAt, DateTime.zoneMakeLocal());
      assert.strictEqual(path.basename(folder), sessionFolderName(session.id, local));
      assert.strictEqual(path.basename(path.dirname(folder)), "recordings");
      assert.match(path.basename(folder), /^\d{4}-\d{2}-\d{2}_\d{4}_session-1$/);
      assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(`${folder}/session.json`)), {
        id: "session-1",
        startedAt: "2026-11-24T13:02:00.000Z",
        stoppedAt: null,
        appVersion: "1.2.3",
        layout: 1,
      });
      assert.deepStrictEqual(yield* store.folder(session.id), Option.some(folder));
      assert.isTrue(Option.isNone(yield* store.folder(RecordingSessionId.make("session-2"))));
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("read skips a timeline line a crash cut off, and missing files", () =>
    Effect.gen(function* () {
      const store = yield* RecordingStore;
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* store.save(session);
      const start: TimelineEvent = {
        type: "start",
        t: 0,
        at: "2026-11-24T13:02:00Z",
        accessibility: true,
      };
      const focus: TimelineEvent = {
        type: "focus",
        t: 1,
        app: "Word",
        bundleId: "com.microsoft.Word",
        title: null,
      };
      yield* fs.writeFileString(
        `${folder}/timeline.jsonl`,
        `${JSON.stringify(start)}\n${JSON.stringify(focus)}\n{"type":"frame","t":5,"fi`,
      );
      const input = yield* store.read(folder);
      assert.deepStrictEqual(input.events, [start, focus]);
      assert.deepStrictEqual(input.files, []);
      assert.deepStrictEqual(input.clips, []);
      assert.strictEqual(input.session.id, session.id);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect(
    "clips are numbered in order, and only one with sound and no transcript is untranscribed",
    () =>
      Effect.gen(function* () {
        const store = yield* RecordingStore;
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* store.save(session);
        const startedAt = DateTime.makeUnsafe("2026-11-24T13:05:00Z");
        const clip = { startedAt, stoppedAt: null, language: null };
        const first = yield* store.createClip(folder, clip);
        const second = yield* store.createClip(folder, clip);
        assert.deepStrictEqual([first, second], [`${folder}/clips/001`, `${folder}/clips/002`]);
        assert.deepStrictEqual(yield* store.untranscribed(folder), []);
        yield* fs.writeFileString(`${second}/audio.m4a`, "");
        assert.deepStrictEqual(yield* store.untranscribed(folder), [
          {
            folder: second,
            audio: `${second}/audio.m4a`,
            transcript: `${second}/transcript.jsonl`,
          },
        ]);
        assert.deepStrictEqual(yield* store.unfinished, [folder]);

        yield* store.updateClip(second, (info) => ({ ...info, language: "no" }));
        yield* fs.writeFileString(`${second}/transcript.jsonl`, '{"t":0,"end":1,"text":"hei"}\n');
        yield* fs.writeFileString(
          `${second}/marks.jsonl`,
          '{"t":1,"end":2,"points":[[1,2]]}\n{"t":3',
        );
        assert.deepStrictEqual(yield* store.untranscribed(folder), []);
        const { clips } = yield* store.read(folder);
        assert.deepStrictEqual(
          clips.map(({ name, sound, segments, marks, info }) => ({
            name,
            sound,
            segments,
            marks,
            language: info.language,
          })),
          [
            { name: "001", sound: false, segments: null, marks: 0, language: null },
            { name: "002", sound: true, segments: 1, marks: 1, language: "no" },
          ],
        );
      }).pipe(Effect.provide(inTempDir)),
  );
});
