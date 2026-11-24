/**
 * Test doubles for every port in ../ports. Use these instead of writing mocks in a test.
 * Adding a port? Add its test layer here in the same PR.
 */
import {
  type AccessibilityPermission,
  type ClipInfo,
  clipName,
  clipsFolder,
  FocusTrackingFailed,
  type ScreenCaptureFailed,
  type SessionInfo,
  type TranscriptionFailed,
  RecordingSessionId,
  ScreenCapturePermissionDenied,
  ScreenshotId,
  type ScreenCapturePermission,
  emptyFocus,
  makeAppAdapter,
  type AppAdapter,
  type FocusSnapshot,
  type Rect,
  type RecordingSession,
  type WindowKind,
} from "@kladd/domain";
import { Context, Effect, Layer, Option, Ref, Stream } from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { ClipCapture } from "../ports/ClipCapture";
import { FocusTracker } from "../ports/FocusTracker";
import { Ids } from "../ports/Ids";
import { OverlayWindows } from "../ports/OverlayWindows";
import { RecordingStore } from "../ports/RecordingStore";
import { ScreenCapture } from "../ports/ScreenCapture";
import { ScreenshotFiles } from "../ports/ScreenshotFiles";
import { SessionCapture } from "../ports/SessionCapture";
import { Transcriber } from "../ports/Transcriber";

const screenCaptureTest = (
  permission: ScreenCapturePermission,
  afterRequest: ScreenCapturePermission,
  /** Runs before every permission check: Effect.yieldNow lets concurrent calls interleave. */
  pause: Effect.Effect<void> = Effect.void,
) =>
  Layer.effect(
    ScreenCapture,
    Effect.gen(function* () {
      const current = yield* Ref.make(permission);
      const capture = Effect.flatMap(Ref.get(current), (now) =>
        now === "granted" ? Effect.void : Effect.fail(new ScreenCapturePermissionDenied({})),
      );
      return ScreenCapture.of({
        permission: Effect.andThen(pause, Ref.get(current)),
        requestPermission: Ref.set(current, afterRequest).pipe(Effect.as(afterRequest)),
        screenshot: () => capture,
        recordVideo: () => Effect.as(capture, { stop: Effect.void }),
      });
    }),
  );

/** Screenshots and video succeed only while permission is granted. */
export const ScreenCaptureTest = {
  granted: screenCaptureTest("granted", "granted"),
  /** Like granted, but the permission check yields first, so concurrent calls interleave. */
  slow: screenCaptureTest("granted", "granted", Effect.yieldNow),
  /** Denied, and the user does not grant it when asked. */
  denied: screenCaptureTest("denied", "denied"),
  /** Denied until asked; the user grants it. */
  grantedOnRequest: screenCaptureTest("denied", "granted"),
  /** Granted, but asking again would revoke it: shows that a granted permission is not requested. */
  grantedRevokedOnRequest: screenCaptureTest("granted", "denied"),
};

/**
 * Writes nothing; starts and stops at once, or after running `start` or `stop`: Effect.sleep for
 * the helper's latency, Effect.never for a start that never reports ready.
 */
export const ClipCaptureTest = (
  wait: { readonly start?: Effect.Effect<void>; readonly stop?: Effect.Effect<void> } = {},
) =>
  Layer.succeed(
    ClipCapture,
    ClipCapture.of({
      start: () => Effect.as(wait.start ?? Effect.void, { stop: wait.stop ?? Effect.void }),
    }),
  );

/** What SessionCaptureTest saw. Read it with `yield* SessionCaptureLog` in a test. */
export class SessionCaptureLog extends Context.Service<
  SessionCaptureLog,
  Ref.Ref<{ readonly started: ReadonlyArray<string>; readonly stopped: number }>
>()("kladd/core/testing/SessionCaptureLog") {}

/**
 * Starts and stops at once and writes nothing; logs the folders it started in, and stops, in
 * SessionCaptureLog. Given a `start` or `stop` failure, that step fails with it.
 */
export const SessionCaptureTest = (
  fail: {
    readonly start?: ScreenCaptureFailed;
    readonly stop?: ScreenCaptureFailed;
  } = {},
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const log = yield* Ref.make<{ started: ReadonlyArray<string>; stopped: number }>({
        started: [],
        stopped: 0,
      });
      const stop = Ref.update(log, (l) => ({ ...l, stopped: l.stopped + 1 })).pipe(
        Effect.andThen(fail.stop ? Effect.fail(fail.stop) : Effect.void),
      );
      const capture = SessionCapture.of({
        start: (dir) =>
          fail.start
            ? Effect.fail(fail.start)
            : Ref.update(log, (l) => ({ ...l, started: [...l.started, dir] })).pipe(
                Effect.as({ stop }),
              ),
      });
      return Layer.mergeAll(
        Layer.succeed(SessionCapture, capture),
        Layer.succeed(SessionCaptureLog, log),
      );
    }),
  );

/** What TranscriberTest saw: the audio file of every transcribe. Read it with `yield* TranscriberLog`. */
export class TranscriberLog extends Context.Service<
  TranscriberLog,
  Ref.Ref<{ readonly prepared: number; readonly transcribed: ReadonlyArray<string> }>
>()("kladd/core/testing/TranscriberLog") {}

/**
 * The model is always there; writes no transcript and detects `language` (default "no"). Given a
 * TranscriptionFailed, every transcribe fails with it.
 */
export const TranscriberTest = (language: string | TranscriptionFailed = "no") =>
  Layer.unwrap(
    Effect.gen(function* () {
      const log = yield* Ref.make<{ prepared: number; transcribed: ReadonlyArray<string> }>({
        prepared: 0,
        transcribed: [],
      });
      const transcriber = Transcriber.of({
        prepare: Ref.update(log, (l) => ({ ...l, prepared: l.prepared + 1 })),
        transcribe: (audio) =>
          Ref.update(log, (l) => ({ ...l, transcribed: [...l.transcribed, audio] })).pipe(
            Effect.andThen(
              typeof language === "string" ? Effect.succeed(language) : Effect.fail(language),
            ),
          ),
      });
      return Layer.mergeAll(
        Layer.succeed(Transcriber, transcriber),
        Layer.succeed(TranscriberLog, log),
      );
    }),
  );

/**
 * In-memory store. Starts empty. Folders are `/recordings/<id>`, clips `/recordings/<id>/clips/001`,
 * with no sound and no live files; RecordingStoreFile's tests cover reading real ones.
 */
export const RecordingStoreTest = Layer.effect(
  RecordingStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(Option.none<RecordingSession>());
    const infos = yield* Ref.make(new Map<string, SessionInfo>());
    const overviews = yield* Ref.make(new Set<string>());
    const clips = yield* Ref.make(new Map<string, ClipInfo>());
    const folderOf = (id: string) => `/recordings/${id}`;
    const info = (folder: string) =>
      Ref.get(infos).pipe(
        Effect.flatMap((all) => Effect.fromNullishOr(all.get(folder))),
        Effect.orDie,
      );
    return RecordingStore.of({
      active: Ref.get(ref),
      save: Effect.fn("RecordingStoreTest.save")(function* (session: RecordingSession) {
        const folder = folderOf(session.id);
        const created: SessionInfo = {
          id: session.id,
          startedAt: session.startedAt,
          stoppedAt: null,
          appVersion: "0.0.0-test",
          layout: 1,
        };
        yield* Ref.update(infos, (all) => new Map(all).set(folder, created));
        yield* Ref.set(ref, Option.some(session));
        return folder;
      }),
      clear: Ref.set(ref, Option.none()),
      unfinished: Effect.gen(function* () {
        const written = yield* Ref.get(overviews);
        return [...(yield* Ref.get(infos)).keys()].filter((folder) => !written.has(folder));
      }),
      folder: (id) =>
        Ref.get(infos).pipe(
          Effect.map((all) => Option.some(folderOf(id)).pipe(Option.filter((f) => all.has(f)))),
        ),
      updateInfo: (folder, update) =>
        Effect.flatMap(info(folder), (current) =>
          Ref.update(infos, (all) => new Map(all).set(folder, update(current))),
        ),
      createClip: (folder, created) =>
        Ref.modify(clips, (all) => {
          const inFolder = [...all.keys()].filter((clip) => clip.startsWith(`${folder}/`));
          const clip = `${folder}/${clipsFolder}/${clipName(inFolder.length + 1)}`;
          return [clip, new Map(all).set(clip, created)];
        }),
      updateClip: (clip, update) =>
        Ref.update(clips, (all) => {
          const current = all.get(clip);
          return current === undefined ? all : new Map(all).set(clip, update(current));
        }),
      untranscribed: () => Effect.succeed([]),
      read: (folder) =>
        Effect.all({ session: info(folder), all: Ref.get(clips) }).pipe(
          Effect.map(({ session, all }) => ({
            session,
            events: [],
            files: [],
            clips: [...all]
              .filter(([clip]) => clip.startsWith(`${folder}/`))
              .map(([clip, clipInfo]) => ({
                name: clip.slice(clip.lastIndexOf("/") + 1),
                info: clipInfo,
                sound: false,
                segments: null,
                marks: 0,
              })),
          })),
        ),
      writeOverview: (folder) => Ref.update(overviews, (all) => new Set(all).add(folder)),
    });
  }),
);

/**
 * Recording sessions are "session-1", "session-2", ...; screenshots are UUIDs ending in their
 * number: "00000000-0000-7000-8000-000000000001", ...
 */
export const IdsTest = Layer.effect(
  Ids,
  Effect.gen(function* () {
    const sessions = yield* Ref.make(0);
    const screenshots = yield* Ref.make(0);
    return Ids.of({
      recordingSessionId: Ref.updateAndGet(sessions, (n) => n + 1).pipe(
        Effect.map((n) => RecordingSessionId.make(`session-${n}`)),
      ),
      screenshotId: Ref.updateAndGet(screenshots, (n) => n + 1).pipe(
        Effect.map((n) =>
          ScreenshotId.make(`00000000-0000-7000-8000-${String(n).padStart(12, "0")}`),
        ),
      ),
    });
  }),
);

/** Screenshots go to /screenshots/<id>.png. */
export const ScreenshotFilesTest = Layer.succeed(
  ScreenshotFiles,
  ScreenshotFiles.of({ file: (id) => Effect.succeed(`/screenshots/${id}.png`) }),
);

/** What FocusTrackerTest saw. Read it with `yield* FocusTrackerLog` in a test. */
export class FocusTrackerLog extends Context.Service<
  FocusTrackerLog,
  Ref.Ref<{ readonly permissionRequests: number }>
>()("kladd/core/testing/FocusTrackerLog") {}

/**
 * Always reports `snapshot` (default: nothing known, as without Accessibility permission).
 * `permission` is what it reports before and after a request; counts requests in FocusTrackerLog.
 * Given a FocusTrackingFailed, every call fails with it. Given an Effect, `current` runs it.
 * `watch` emits `changes` (default: what `current` reports, then nothing).
 */
export const FocusTrackerTest = (
  snapshot: FocusSnapshot | FocusTrackingFailed | Effect.Effect<FocusSnapshot> = emptyFocus,
  permission: {
    readonly before: AccessibilityPermission;
    readonly after: AccessibilityPermission;
    /** Runs before a request answers: Effect.never for a user who leaves the prompt open. */
    readonly answer?: Effect.Effect<void>;
  } = { before: "granted", after: "granted" },
  changes?: Stream.Stream<FocusSnapshot, FocusTrackingFailed>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const log = yield* Ref.make({ permissionRequests: 0 });
      const current = yield* Ref.make(permission.before);
      const failed = snapshot instanceof FocusTrackingFailed ? snapshot : null;
      const orFail = <A>(effect: Effect.Effect<A>) =>
        failed === null ? effect : Effect.andThen(effect, Effect.fail(failed));
      const read = Effect.isEffect(snapshot)
        ? snapshot
        : snapshot instanceof FocusTrackingFailed
          ? Effect.fail(snapshot)
          : Effect.succeed(snapshot);
      const tracker = FocusTracker.of({
        current: read,
        watch: changes ?? Stream.fromEffect(read),
        permission: orFail(Ref.get(current)),
        requestPermission: orFail(
          Ref.update(log, (l) => ({ permissionRequests: l.permissionRequests + 1 })).pipe(
            Effect.andThen(permission.answer ?? Effect.void),
            Effect.andThen(Ref.set(current, permission.after)),
            Effect.as(permission.after),
          ),
        ),
      });
      return Layer.mergeAll(
        Layer.succeed(FocusTracker, tracker),
        Layer.succeed(FocusTrackerLog, log),
      );
    }),
  );

/** The registered adapters: none by default, with a fallback that anchors to the caret. */
export const AppAdaptersTest = (all: ReadonlyArray<AppAdapter> = []) =>
  Layer.succeed(
    AppAdapters,
    AppAdapters.of({
      all,
      fallback: makeAppAdapter({ id: "test-fallback", bundleIds: [], anchor: (f) => f.caret }),
    }),
  );

interface ShownWindow {
  readonly kind: WindowKind;
  readonly bounds: Rect | undefined;
  /** Set when this entry is a `hide`. */
  readonly hidden?: true;
}

/** What OverlayWindowsTest saw. Read it with `yield* OverlayWindowsLog` in a test. */
export class OverlayWindowsLog extends Context.Service<
  OverlayWindowsLog,
  Ref.Ref<ReadonlyArray<ShownWindow>>
>()("kladd/core/testing/OverlayWindowsLog") {}

const testSize = { width: 300, height: 400 };
const testDisplay = { x: 0, y: 0, width: 1440, height: 900 };

/** Records every `show` and `hide` in OverlayWindowsLog. Every window is 300x400 on a 1440x900 screen. */
export const OverlayWindowsTest = Layer.unwrap(
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<ShownWindow>>([]);
    const windows = OverlayWindows.of({
      show: (kind, bounds) => Ref.update(log, (shown) => [...shown, { kind, bounds }]),
      hide: (kind) =>
        Ref.update(log, (shown): ReadonlyArray<ShownWindow> => [
          ...shown,
          { kind, bounds: undefined, hidden: true },
        ]),
      prepare: () => Effect.void,
      moveTo: () => Effect.void,
      setClickThrough: () => Effect.void,
      size: () => testSize,
      workArea: () => Effect.succeed(testDisplay),
      mainDisplay: Effect.succeed(testDisplay),
    });
    return Layer.mergeAll(
      Layer.succeed(OverlayWindows, windows),
      Layer.succeed(OverlayWindowsLog, log),
    );
  }),
);
