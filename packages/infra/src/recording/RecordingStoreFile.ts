import { RecordingStore } from "@kladd/core";
import {
  FileChange,
  RecordingSession,
  type RecordingSessionId,
  SessionInfo,
  TimelineEvent,
  TranscriptSegment,
  isSessionFolderOf,
  sessionFiles,
  sessionFolderName,
} from "@kladd/domain";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { StorageConfig } from "../StorageConfig";

// toCodecJson turns non-JSON fields (DateTime) into JSON-safe values before stringifying.
const ActiveRecordingJson = Schema.fromJsonString(Schema.toCodecJson(RecordingSession));
const SessionInfoJson = Schema.fromJsonString(Schema.toCodecJson(SessionInfo));

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(TimelineEvent));
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(FileChange));
const decodeSegment = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptSegment));

/**
 * RecordingStore backed by files in StorageConfig.dataDir: `active-recording.json`, and a session
 * folder per recording in `recordings/` (layout: sessionFiles in @kladd/domain).
 * Needs FileSystem and Path, which apps/desktop provides (NodeServices from @effect/platform-node).
 */
export const RecordingStoreFile = Layer.effect(
  RecordingStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dataDir, appVersion } = yield* StorageConfig;
    const file = path.join(dataDir, "active-recording.json");
    const recordings = path.join(dataDir, "recordings");

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

    const writeInfo = Effect.fn("RecordingStoreFile.writeInfo")(function* (
      folder: string,
      info: SessionInfo,
    ) {
      const json = yield* Schema.encodeEffect(SessionInfoJson)(info);
      yield* fs.writeFileString(path.join(folder, sessionFiles.session), json);
    });

    const readInfo = Effect.fn("RecordingStoreFile.readInfo")(function* (folder: string) {
      const json = yield* fs.readFileString(path.join(folder, sessionFiles.session));
      return yield* Schema.decodeEffect(SessionInfoJson)(json);
    });

    const save = Effect.fn("RecordingStoreFile.save")(function* (session: RecordingSession) {
      const startedAt = DateTime.setZone(session.startedAt, DateTime.zoneMakeLocal());
      const folder = path.join(recordings, sessionFolderName(session.id, startedAt));
      yield* fs.makeDirectory(folder, { recursive: true });
      yield* writeInfo(folder, {
        id: session.id,
        startedAt: session.startedAt,
        stoppedAt: null,
        language: null,
        appVersion,
        layout: 1,
      });
      yield* fs.writeFileString(file, yield* Schema.encodeEffect(ActiveRecordingJson)(session));
      return folder;
    }, Effect.orDie);

    const clear = fs
      .remove(file, { force: true })
      .pipe(Effect.orDie, Effect.withSpan("RecordingStoreFile.clear"));

    const unfinished = Effect.gen(function* () {
      if (!(yield* fs.exists(recordings))) return [];
      const has = (folder: string, name: string) => fs.exists(path.join(folder, name));
      const found: Array<string> = [];
      for (const name of yield* fs.readDirectory(recordings)) {
        const folder = path.join(recordings, name);
        if ((yield* fs.stat(folder)).type !== "Directory") continue;
        const finished =
          (yield* has(folder, sessionFiles.overview)) &&
          (!(yield* has(folder, sessionFiles.audio)) ||
            (yield* has(folder, sessionFiles.transcript)));
        if (!finished) found.push(folder);
      }
      return found;
    }).pipe(Effect.orDie, Effect.withSpan("RecordingStoreFile.unfinished"));

    const folder = Effect.fn("RecordingStoreFile.folder")(function* (id: RecordingSessionId) {
      if (!(yield* fs.exists(recordings))) return Option.none<string>();
      const names = yield* fs.readDirectory(recordings);
      return Option.fromNullishOr(names.find((name) => isSessionFolderOf(name, id))).pipe(
        Option.map((name) => path.join(recordings, name)),
      );
    }, Effect.orDie);

    const updateInfo = Effect.fn("RecordingStoreFile.updateInfo")(function* (
      folder: string,
      update: (info: SessionInfo) => SessionInfo,
    ) {
      yield* writeInfo(folder, update(yield* readInfo(folder)));
    }, Effect.orDie);

    const audio = Effect.fn("RecordingStoreFile.audio")(function* (folder: string) {
      const audioFile = path.join(folder, sessionFiles.audio);
      if (!(yield* fs.exists(audioFile))) return Option.none();
      return Option.some({
        audio: audioFile,
        transcript: path.join(folder, sessionFiles.transcript),
      });
    }, Effect.orDie);

    /** The lines of a JSON Lines file that decode; none if it doesn't exist. */
    const readLines = Effect.fn("RecordingStoreFile.readLines")(function* <A>(
      file: string,
      decode: (line: string) => Option.Option<A>,
    ) {
      if (!(yield* fs.exists(file))) return [];
      const lines = (yield* fs.readFileString(file)).split("\n").filter((l) => l.trim() !== "");
      const decoded = lines.flatMap((line) => Option.toArray(decode(line)));
      if (decoded.length < lines.length) {
        yield* Effect.logWarning(`Skipped ${lines.length - decoded.length} bad lines in ${file}`);
      }
      return decoded;
    });

    const read = Effect.fn("RecordingStoreFile.read")(function* (folder: string) {
      return {
        session: yield* readInfo(folder),
        events: yield* readLines(path.join(folder, sessionFiles.timeline), decodeEvent),
        files: yield* readLines(path.join(folder, sessionFiles.files), decodeFile),
        transcript: yield* readLines(path.join(folder, sessionFiles.transcript), decodeSegment),
      };
    }, Effect.orDie);

    const writeOverview = Effect.fn("RecordingStoreFile.writeOverview")(function* (
      folder: string,
      text: string,
    ) {
      yield* fs.writeFileString(path.join(folder, sessionFiles.overview), text);
    }, Effect.orDie);

    return RecordingStore.of({
      active,
      save,
      clear,
      unfinished,
      folder,
      updateInfo,
      audio,
      read,
      writeOverview,
    });
  }),
);
