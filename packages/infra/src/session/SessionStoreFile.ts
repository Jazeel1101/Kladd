import { SessionStore, type StoredSession, type UntranscribedClip } from "@kladd/core";
import {
  ClipInfo,
  Mark,
  type OverviewClip,
  type ScreenshotId,
  ScreenshotInfo,
  Session,
  type SessionId,
  SessionInfo,
  TimelineEvent,
  TranscriptSegment,
  clipFiles,
  clipName,
  clipsFolder,
  isSessionFolderOf,
  sessionFiles,
  sessionFolderName,
  sessionInfo,
} from "@kladd/domain";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { StorageConfig } from "../StorageConfig";

// toCodecJson turns non-JSON fields (DateTime) into JSON-safe values before stringifying.
const SessionInfoJson = Schema.fromJsonString(Schema.toCodecJson(SessionInfo));
const ScreenshotInfoJson = Schema.fromJsonString(Schema.toCodecJson(ScreenshotInfo));
const ClipInfoJson = Schema.fromJsonString(Schema.toCodecJson(ClipInfo));

const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(TimelineEvent));
const decodeSegment = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptSegment));
const decodeMark = Schema.decodeUnknownOption(Schema.fromJsonString(Mark));

const sessionOf = ({ id, mode, startedAt, endedAt, loggedAt }: SessionInfo) =>
  new Session({ id, mode, startedAt, endedAt, loggedAt });

/**
 * SessionStore backed by a session folder per session in StorageConfig.dataDir's `sessions/`
 * (layout: sessionFiles and clipFiles in @kladd/domain). Folders of the first layout, in
 * `recordings/`, are left as they are and never read.
 * Needs FileSystem and Path, which apps/desktop provides (NodeServices from @effect/platform-node).
 */
export const SessionStoreFile = Layer.effect(
  SessionStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dataDir, appVersion } = yield* StorageConfig;
    const sessions = path.join(dataDir, "sessions");

    const writeInfo = Effect.fn("SessionStoreFile.writeInfo")(function* (
      folder: string,
      info: SessionInfo,
    ) {
      // Renamed into place: a session.json cut off by a crash would lose the session.
      const file = path.join(folder, sessionFiles.session);
      yield* fs.writeFileString(`${file}.tmp`, yield* Schema.encodeEffect(SessionInfoJson)(info));
      yield* fs.rename(`${file}.tmp`, file);
    });

    const readInfo = Effect.fn("SessionStoreFile.readInfo")(function* (folder: string) {
      const json = yield* fs.readFileString(path.join(folder, sessionFiles.session));
      return yield* Schema.decodeEffect(SessionInfoJson)(json);
    });

    const list = Effect.gen(function* () {
      if (!(yield* fs.exists(sessions))) return [];
      const found: Array<StoredSession> = [];
      for (const name of yield* fs.readDirectory(sessions)) {
        const folder = path.join(sessions, name);
        if ((yield* fs.stat(folder)).type !== "Directory") continue;
        const info = yield* readInfo(folder).pipe(
          Effect.tapError((error) => Effect.logWarning(`Skipped the session ${folder}`, error)),
          Effect.option,
        );
        if (Option.isSome(info)) found.push({ folder, session: sessionOf(info.value) });
      }
      return found.toSorted(
        (a, b) =>
          DateTime.toEpochMillis(b.session.startedAt) - DateTime.toEpochMillis(a.session.startedAt),
      );
    }).pipe(Effect.orDie, Effect.withSpan("SessionStoreFile.list"));

    const create = Effect.fn("SessionStoreFile.create")(function* (session: Session) {
      const startedAt = DateTime.setZone(session.startedAt, DateTime.zoneMakeLocal());
      const folder = path.join(sessions, sessionFolderName(session.id, startedAt));
      yield* fs.makeDirectory(folder, { recursive: true });
      yield* writeInfo(folder, sessionInfo(session, appVersion));
      return folder;
    }, Effect.orDie);

    // Keeps the version of Kladd the session was started with.
    const update = Effect.fn("SessionStoreFile.update")(function* (
      folder: string,
      session: Session,
    ) {
      yield* writeInfo(folder, sessionInfo(session, (yield* readInfo(folder)).appVersion));
    }, Effect.orDie);

    const remove = Effect.fn("SessionStoreFile.remove")(function* (folder: string) {
      yield* fs.remove(folder, { recursive: true });
    }, Effect.orDie);

    const folder = Effect.fn("SessionStoreFile.folder")(function* (id: SessionId) {
      if (!(yield* fs.exists(sessions))) return Option.none<string>();
      const names = yield* fs.readDirectory(sessions);
      return Option.fromNullishOr(names.find((name) => isSessionFolderOf(name, id))).pipe(
        Option.map((name) => path.join(sessions, name)),
      );
    }, Effect.orDie);

    /** The lines of a JSON Lines file that decode; none if it doesn't exist. */
    const readLines = Effect.fn("SessionStoreFile.readLines")(function* <A>(
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

    const screenshotsDir = (folder: string) => path.join(folder, sessionFiles.screenshots);

    const screenshotFile = Effect.fn("SessionStoreFile.screenshotFile")(function* (
      folder: string,
      id: ScreenshotId,
    ) {
      yield* fs.makeDirectory(screenshotsDir(folder), { recursive: true });
      return path.join(screenshotsDir(folder), `${id}.png`);
    }, Effect.orDie);

    const saveScreenshot = Effect.fn("SessionStoreFile.saveScreenshot")(function* (
      folder: string,
      info: ScreenshotInfo,
    ) {
      const json = yield* Schema.encodeEffect(ScreenshotInfoJson)(info);
      yield* fs.writeFileString(path.join(screenshotsDir(folder), `${info.id}.json`), json);
    }, Effect.orDie);

    const screenshots = Effect.fn("SessionStoreFile.screenshots")(function* (folder: string) {
      const dir = screenshotsDir(folder);
      if (!(yield* fs.exists(dir))) return [];
      const found: Array<ScreenshotInfo> = [];
      for (const name of yield* fs.readDirectory(dir)) {
        if (!name.endsWith(".json")) continue;
        const info = yield* fs.readFileString(path.join(dir, name)).pipe(
          Effect.flatMap(Schema.decodeEffect(ScreenshotInfoJson)),
          Effect.tapError((error) => Effect.logWarning(`Skipped the screenshot ${name}`, error)),
          Effect.option,
        );
        if (Option.isSome(info)) found.push(info.value);
      }
      return found.toSorted(
        (a, b) => DateTime.toEpochMillis(a.takenAt) - DateTime.toEpochMillis(b.takenAt),
      );
    }, Effect.orDie);

    /** The clip folders of a session folder, in order. */
    const clipFolders = Effect.fn("SessionStoreFile.clipFolders")(function* (folder: string) {
      const dir = path.join(folder, clipsFolder);
      if (!(yield* fs.exists(dir))) return [];
      return (yield* fs.readDirectory(dir)).toSorted().map((name) => path.join(dir, name));
    });

    const readClip = Effect.fn("SessionStoreFile.readClip")(function* (clip: string) {
      const json = yield* fs.readFileString(path.join(clip, clipFiles.clip));
      return yield* Schema.decodeEffect(ClipInfoJson)(json);
    });

    const untranscribed = Effect.fn("SessionStoreFile.untranscribed")(function* (folder: string) {
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

    const finished = Effect.fn("SessionStoreFile.finished")(function* (folder: string) {
      return (
        (yield* fs.exists(path.join(folder, sessionFiles.overview))) &&
        (yield* untranscribed(folder)).length === 0 &&
        ((yield* readInfo(folder)).loggedAt !== null ||
          (yield* fs.exists(path.join(folder, sessionFiles.summary))))
      );
    }, Effect.orDie);

    const summary = Effect.fn("SessionStoreFile.summary")(function* (folder: string) {
      const file = path.join(folder, sessionFiles.summary);
      if (!(yield* fs.exists(file))) return Option.none<string>();
      return Option.some(yield* fs.readFileString(file));
    }, Effect.orDie);

    const writeClip = Effect.fn("SessionStoreFile.writeClip")(function* (
      clip: string,
      info: ClipInfo,
    ) {
      const json = yield* Schema.encodeEffect(ClipInfoJson)(info);
      yield* fs.writeFileString(path.join(clip, clipFiles.clip), json);
    });

    const createClip = Effect.fn("SessionStoreFile.createClip")(function* (
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

    const removeClip = Effect.fn("SessionStoreFile.removeClip")(function* (clip: string) {
      yield* fs.remove(clip, { recursive: true });
    }, Effect.orDie);

    const updateClip = Effect.fn("SessionStoreFile.updateClip")(function* (
      clip: string,
      update: (info: ClipInfo) => ClipInfo,
    ) {
      yield* writeClip(clip, update(yield* readClip(clip)));
    }, Effect.orDie);

    /** What the overview says about a clip; fails if its `clip.json` is unreadable. */
    const overviewClip = Effect.fn("SessionStoreFile.overviewClip")(function* (clip: string) {
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

    const read = Effect.fn("SessionStoreFile.read")(function* (folder: string) {
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
        screenshots: yield* screenshots(folder),
        clips,
      };
    }, Effect.orDie);

    const writeOverview = Effect.fn("SessionStoreFile.writeOverview")(function* (
      folder: string,
      text: string,
    ) {
      // Renamed into place: a folder with overview.md counts as finished, so it is never half written.
      const file = path.join(folder, sessionFiles.overview);
      yield* fs.writeFileString(`${file}.tmp`, text);
      yield* fs.rename(`${file}.tmp`, file);
    }, Effect.orDie);

    return SessionStore.of({
      list,
      create,
      update,
      remove,
      folder,
      finished,
      summary,
      screenshotFile,
      saveScreenshot,
      screenshots,
      createClip,
      removeClip,
      updateClip,
      untranscribed,
      read,
      writeOverview,
    });
  }),
);
