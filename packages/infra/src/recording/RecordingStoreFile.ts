import { RecordingStore, type UntranscribedClip } from "@kladd/core";
import {
  ClipInfo,
  Mark,
  type OverviewClip,
  RecordingSession,
  type RecordingSessionId,
  SessionInfo,
  TimelineEvent,
  TranscriptSegment,
  clipFiles,
  clipName,
  clipsFolder,
  isSessionFolderOf,
  sessionFiles,
  sessionFolderName,
} from "@kladd/domain";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { StorageConfig } from "../StorageConfig";

// toCodecJson turns non-JSON fields (DateTime) into JSON-safe values before stringifying.
const ActiveRecordingJson = Schema.fromJsonString(Schema.toCodecJson(RecordingSession));
const SessionInfoJson = Schema.fromJsonString(Schema.toCodecJson(SessionInfo));
const ClipInfoJson = Schema.fromJsonString(Schema.toCodecJson(ClipInfo));

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(TimelineEvent));
const decodeSegment = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptSegment));
const decodeMark = Schema.decodeUnknownOption(Schema.fromJsonString(Mark));

/**
 * RecordingStore backed by files in StorageConfig.dataDir: `active-recording.json`, and a session
 * folder per recording in `recordings/` (layout: sessionFiles and clipFiles in @kladd/domain).
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
        appVersion,
        layout: 1,
      });
      yield* fs.writeFileString(file, yield* Schema.encodeEffect(ActiveRecordingJson)(session));
      return folder;
    }, Effect.orDie);

    const clear = fs
      .remove(file, { force: true })
      .pipe(Effect.orDie, Effect.withSpan("RecordingStoreFile.clear"));

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

    /** The clip folders of a session folder, in order. */
    const clipFolders = Effect.fn("RecordingStoreFile.clipFolders")(function* (folder: string) {
      const dir = path.join(folder, clipsFolder);
      if (!(yield* fs.exists(dir))) return [];
      return (yield* fs.readDirectory(dir)).toSorted().map((name) => path.join(dir, name));
    });

    const readClip = Effect.fn("RecordingStoreFile.readClip")(function* (clip: string) {
      const json = yield* fs.readFileString(path.join(clip, clipFiles.clip));
      return yield* Schema.decodeEffect(ClipInfoJson)(json);
    });

    const untranscribed = Effect.fn("RecordingStoreFile.untranscribed")(function* (folder: string) {
      const found: Array<UntranscribedClip> = [];
      for (const clip of yield* clipFolders(folder)) {
        const audio = path.join(clip, clipFiles.audio);
        const transcript = path.join(clip, clipFiles.transcript);
        if ((yield* fs.exists(audio)) && !(yield* fs.exists(transcript))) {
          found.push({ folder: clip, audio, transcript });
        }
      }
      return found;
    }, Effect.orDie);

    const unfinished = Effect.gen(function* () {
      if (!(yield* fs.exists(recordings))) return [];
      const found: Array<string> = [];
      for (const name of yield* fs.readDirectory(recordings)) {
        const folder = path.join(recordings, name);
        if ((yield* fs.stat(folder)).type !== "Directory") continue;
        const finished =
          (yield* fs.exists(path.join(folder, sessionFiles.overview))) &&
          (yield* untranscribed(folder)).length === 0;
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

    const writeClip = Effect.fn("RecordingStoreFile.writeClip")(function* (
      clip: string,
      info: ClipInfo,
    ) {
      const json = yield* Schema.encodeEffect(ClipInfoJson)(info);
      yield* fs.writeFileString(path.join(clip, clipFiles.clip), json);
    });

    const createClip = Effect.fn("RecordingStoreFile.createClip")(function* (
      folder: string,
      info: ClipInfo,
    ) {
      const clip = path.join(
        folder,
        clipsFolder,
        clipName((yield* clipFolders(folder)).length + 1),
      );
      yield* fs.makeDirectory(clip, { recursive: true });
      yield* writeClip(clip, info);
      return clip;
    }, Effect.orDie);

    const removeClip = Effect.fn("RecordingStoreFile.removeClip")(function* (clip: string) {
      yield* fs.remove(clip, { recursive: true });
    }, Effect.orDie);

    const updateClip = Effect.fn("RecordingStoreFile.updateClip")(function* (
      clip: string,
      update: (info: ClipInfo) => ClipInfo,
    ) {
      yield* writeClip(clip, update(yield* readClip(clip)));
    }, Effect.orDie);

    /** What the overview says about a clip; fails if its `clip.json` is unreadable. */
    const overviewClip = Effect.fn("RecordingStoreFile.overviewClip")(function* (clip: string) {
      const transcript = path.join(clip, clipFiles.transcript);
      return {
        name: path.basename(clip),
        info: yield* readClip(clip),
        sound: yield* fs.exists(path.join(clip, clipFiles.audio)),
        segments: (yield* fs.exists(transcript))
          ? (yield* readLines(transcript, decodeSegment)).length
          : null,
        marks: (yield* readLines(path.join(clip, clipFiles.marks), decodeMark)).length,
      };
    });

    const read = Effect.fn("RecordingStoreFile.read")(function* (folder: string) {
      const clips: Array<OverviewClip> = [];
      for (const clip of yield* clipFolders(folder)) {
        const found = yield* overviewClip(clip).pipe(
          Effect.tapError((error) => Effect.logWarning(`Could not read the clip ${clip}`, error)),
          Effect.option,
        );
        if (Option.isSome(found)) clips.push(found.value);
      }
      return {
        session: yield* readInfo(folder),
        events: yield* readLines(path.join(folder, sessionFiles.timeline), decodeEvent),
        clips,
      };
    }, Effect.orDie);

    const writeOverview = Effect.fn("RecordingStoreFile.writeOverview")(function* (
      folder: string,
      text: string,
    ) {
      // Renamed into place: a folder with overview.md counts as finished, so it is never half written.
      const file = path.join(folder, sessionFiles.overview);
      yield* fs.writeFileString(`${file}.tmp`, text);
      yield* fs.rename(`${file}.tmp`, file);
    }, Effect.orDie);

    return RecordingStore.of({
      active,
      save,
      clear,
      unfinished,
      folder,
      updateInfo,
      createClip,
      removeClip,
      updateClip,
      untranscribed,
      read,
      writeOverview,
    });
  }),
);
