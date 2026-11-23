import * as NodeServices from "@effect/platform-node/NodeServices";
import { RecordingStore } from "@kladd/core";
import { RecordingSession, RecordingSessionId } from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { StorageConfig } from "../StorageConfig";
import { RecordingStoreFile } from "./RecordingStoreFile";

const inTempDir = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataDir = yield* fs.makeTempDirectoryScoped();
    return RecordingStoreFile.pipe(
      Layer.provide(Layer.succeed(StorageConfig, StorageConfig.of({ dataDir }))),
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
});
