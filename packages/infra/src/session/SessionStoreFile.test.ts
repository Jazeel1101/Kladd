import * as NodeServices from "@effect/platform-node/NodeServices";
import { SessionStore } from "@kladd/core";
import {
  ScreenshotId,
  Session,
  SessionId,
  type TimelineEvent,
  emptyFocus,
  endSession,
  fieldsOf,
  sessionFolderName,
} from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, Option, Path } from "effect";
import { StorageConfig } from "../StorageConfig";
import { SessionStoreFile } from "./SessionStoreFile";

const inTempDir = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataDir = yield* fs.makeTempDirectoryScoped();
    return SessionStoreFile.pipe(
      Layer.provideMerge(
        Layer.succeed(StorageConfig, StorageConfig.of({ dataDir, appVersion: "1.2.3" })),
      ),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

const session = new Session({
  id: SessionId.make("session-1"),
  mode: "manual",
  startedAt: DateTime.makeUnsafe("2026-11-24T13:02:00Z"),
  endedAt: null,
  loggedAt: null,
});

describe("SessionStoreFile", () => {
  it.effect("lists nothing when nothing was saved", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* (yield* SessionStore).list, []);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("create makes the folder, named after the local start time, with session.json", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* store.create(session);
      const local = DateTime.setZone(session.startedAt, DateTime.zoneMakeLocal());
      assert.strictEqual(path.basename(folder), sessionFolderName(session.id, local));
      assert.strictEqual(path.basename(path.dirname(folder)), "sessions");
      assert.match(path.basename(folder), /^\d{4}-\d{2}-\d{2}_\d{4}_session-1$/);
      assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(`${folder}/session.json`)), {
        id: "session-1",
        mode: "manual",
        startedAt: "2026-11-24T13:02:00.000Z",
        endedAt: null,
        loggedAt: null,
        appVersion: "1.2.3",
        layout: 2,
      });
      assert.deepStrictEqual(yield* store.folder(session.id), Option.some(folder));
      assert.isTrue(Option.isNone(yield* store.folder(SessionId.make("session-2"))));
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("lists sessions newest first as they were last updated, and forgets removed ones", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const older = yield* store.create(session);
      const later = new Session({
        ...fieldsOf(session),
        id: SessionId.make("session-2"),
        startedAt: DateTime.makeUnsafe("2026-11-25T08:00:00Z"),
      });
      const newer = yield* store.create(later);
      const ended = endSession(session, DateTime.makeUnsafe("2026-11-24T14:00:00Z"));
      yield* store.update(older, ended);
      assert.deepStrictEqual(yield* store.list, [
        { folder: newer, session: later },
        { folder: older, session: ended },
      ]);
      yield* store.remove(newer);
      assert.deepStrictEqual(yield* store.list, [{ folder: older, session: ended }]);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("skips a folder whose session.json is not a session, such as the first layout's", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const fs = yield* FileSystem.FileSystem;
      const { dataDir } = yield* StorageConfig;
      const folder = yield* store.create(session);
      yield* fs.makeDirectory(`${dataDir}/sessions/old`);
      yield* fs.writeFileString(
        `${dataDir}/sessions/old/session.json`,
        '{"id":"x","startedAt":"2026-01-01T00:00:00Z","stoppedAt":null,"layout":1}',
      );
      assert.deepStrictEqual(yield* store.list, [{ folder, session }]);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("saves screenshots beside their PNG, and reads them back oldest first", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* store.create(session);
      const shot = (n: number, takenAt: string) => ({
        id: ScreenshotId.make(`00000000-0000-7000-8000-00000000000${n}`),
        session: session.id,
        takenAt: DateTime.makeUnsafe(takenAt),
        display: { x: 0, y: 0, width: 1440, height: 900 },
        focus: { ...emptyFocus, title: "Løkker" },
      });
      const later = shot(1, "2026-11-24T13:30:00Z");
      const earlier = shot(2, "2026-11-24T13:10:00Z");
      for (const info of [later, earlier]) {
        const file = yield* store.screenshotFile(folder, info.id);
        assert.strictEqual(file, `${folder}/screenshots/${info.id}.png`);
        yield* fs.writeFileString(file, "png");
        yield* store.saveScreenshot(folder, info);
      }
      yield* fs.writeFileString(`${folder}/screenshots/broken.json`, "{");
      assert.deepStrictEqual(yield* store.screenshots(folder), [earlier, later]);
      assert.deepStrictEqual((yield* store.read(folder)).screenshots, [earlier, later]);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("read skips a timeline line a crash cut off, and missing files", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore;
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* store.create(session);
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
      assert.deepStrictEqual(input.screenshots, []);
      assert.deepStrictEqual(input.clips, []);
      assert.strictEqual(input.session.id, session.id);
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect(
    "clips are numbered in order, and only one with sound and no transcript is untranscribed",
    () =>
      Effect.gen(function* () {
        const store = yield* SessionStore;
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* store.create(session);
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
        yield* store.writeOverview(folder, "# Session overview\n");
        assert.isFalse(yield* store.finished(folder));

        yield* store.updateClip(second, (info) => ({ ...info, language: "no" }));
        yield* fs.writeFileString(`${second}/transcript.jsonl`, '{"t":0,"end":1,"text":"hei"}\n');
        yield* fs.writeFileString(
          `${second}/marks.jsonl`,
          '{"t":1,"end":2,"points":[[1,2]]}\n{"t":3',
        );
        assert.deepStrictEqual(yield* store.untranscribed(folder), []);
        // The summary agent was stopped before it wrote summary.md.
        assert.isFalse(yield* store.finished(folder));
        assert.isTrue(Option.isNone(yield* store.summary(folder)));
        yield* fs.writeFileString(`${folder}/summary.md`, "# Oppsummering\n");
        assert.isTrue(yield* store.finished(folder));
        assert.deepStrictEqual(yield* store.summary(folder), Option.some("# Oppsummering\n"));
        yield* fs.remove(`${folder}/summary.md`);
        yield* fs.makeDirectory(`${folder}/summary.md`);
        assert.isTrue(
          Option.isNone(yield* store.summary(folder)),
          "unreadable is as good as missing",
        );
        yield* fs.remove(`${folder}/summary.md`, { recursive: true });
        yield* fs.writeFileString(`${folder}/summary.md`, "# Oppsummering\n");
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
