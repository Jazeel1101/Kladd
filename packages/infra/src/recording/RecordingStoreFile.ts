import { RecordingStore } from "@kladd/core";
import { RecordingSession } from "@kladd/domain";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { StorageConfig } from "../StorageConfig";

// toCodecJson turns non-JSON fields (DateTime) into JSON-safe values before stringifying.
const ActiveRecordingJson = Schema.fromJsonString(Schema.toCodecJson(RecordingSession));

/**
 * RecordingStore backed by a JSON file in StorageConfig.dataDir.
 * Needs FileSystem and Path, which apps/desktop provides (NodeServices from @effect/platform-node).
 */
export const RecordingStoreFile = Layer.effect(
  RecordingStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dataDir } = yield* StorageConfig;
    const file = path.join(dataDir, "active-recording.json");

    const active = Effect.gen(function* () {
      if (!(yield* fs.exists(file))) return Option.none();
      const json = yield* fs.readFileString(file);
      return Option.some(yield* Schema.decodeEffect(ActiveRecordingJson)(json));
    }).pipe(
      // A missing or corrupt file means "no active recording"; log it so it's not silent.
      Effect.tapError((error) => Effect.logWarning("Could not read active recording", error)),
      Effect.orElseSucceed(() => Option.none<RecordingSession>()),
      Effect.withSpan("RecordingStoreFile.active"),
    );

    const save = Effect.fn("RecordingStoreFile.save")(function* (session: RecordingSession) {
      yield* fs.makeDirectory(dataDir, { recursive: true });
      const json = yield* Schema.encodeEffect(ActiveRecordingJson)(session);
      yield* fs.writeFileString(file, json);
    }, Effect.orDie);

    const clear = fs
      .remove(file, { force: true })
      .pipe(Effect.orDie, Effect.withSpan("RecordingStoreFile.clear"));

    return RecordingStore.of({ active, save, clear });
  }),
);
