import {
  NoActiveRecording,
  RecordingAlreadyActive,
  RecordingSession,
  type ScreenCaptureFailed,
  type ScreenCapturePermissionDenied,
} from "@kladd/domain";
import {
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Scope,
  Semaphore,
  type Stream,
  SubscriptionRef,
} from "effect";
import { requireScreenCapture } from "../capture/requireScreenCapture";
import { askForAccessibility } from "../focus/askForAccessibility";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import { FocusTracker } from "../ports/FocusTracker";
import { Ids } from "../ports/Ids";
import { RecordingStore } from "../ports/RecordingStore";
import { ScreenCapture } from "../ports/ScreenCapture";
import { SessionCapture, type SessionCaptureHandle } from "../ports/SessionCapture";
import { Transcriber } from "../ports/Transcriber";
import { finishSession } from "./finishSession";

/** The capture writing the active recording's session folder. */
interface Running {
  readonly folder: string;
  readonly handle: SessionCaptureHandle;
  readonly scope: Scope.Closeable;
}

/**
 * Use case: start, stop and watch recordings. Each recording captures into its own session folder,
 * finished in the background after stop (finishSession). Stopping a recording starts logging mode.
 * A recording a crash left active is finished when Kladd opens, not resumed.
 * A use case depends on ports (../ports) and other use cases, never on infra or platform code.
 */
export class Recordings extends Context.Service<
  Recordings,
  {
    /**
     * Asks for screen capture permission first if Kladd doesn't have it. Once recording, asks for
     * Accessibility in the background (optional: it places the logging overlay next to the text).
     * Fails, with nothing left recording, if the session capture can't start.
     */
    readonly start: Effect.Effect<
      RecordingSession,
      RecordingAlreadyActive | ScreenCapturePermissionDenied | ScreenCaptureFailed
    >;
    /**
     * Stops the active recording and opens the logging overlay. Always stops: a capture that fails
     * to finish is logged, and the folder is finished from what it wrote.
     */
    readonly stop: Effect.Effect<RecordingSession, NoActiveRecording>;
    readonly active: Effect.Effect<Option.Option<RecordingSession>>;
    /** The active recording now, then on every start and stop. */
    readonly changes: Stream.Stream<Option.Option<RecordingSession>>;
  }
>()("kladd/core/Recordings") {
  static readonly layer = Layer.effect(
    Recordings,
    Effect.gen(function* () {
      const capture = yield* ScreenCapture;
      const sessionCapture = yield* SessionCapture;
      const transcriber = yield* Transcriber;
      const focus = yield* FocusTracker;
      const store = yield* RecordingStore;
      const ids = yield* Ids;
      const logging = yield* LoggingOverlay;
      const current = yield* SubscriptionRef.make(Option.none<RecordingSession>());
      const running = yield* Ref.make(Option.none<Running>());
      // Start and stop check, then change, the active recording; one at a time so they can't interleave.
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));
      // The Accessibility prompt outlives start, and only one is shown at a time.
      const layerScope = yield* Effect.scope;
      const asking = yield* Semaphore.make(1);

      // Transcription and overview outlive stop, and never fail it: their failures are logged.
      const finishInBackground = (folder: string, stopped: boolean) =>
        Effect.gen(function* () {
          if (stopped) {
            const stoppedAt = yield* DateTime.now;
            yield* store.updateInfo(folder, (info) => ({ ...info, stoppedAt }));
          }
          yield* finishSession(folder).pipe(
            Effect.provideService(RecordingStore, store),
            Effect.provideService(Transcriber, transcriber),
          );
        }).pipe(
          Effect.ignoreCause({ log: "Warn", message: "Could not finish the session folder" }),
          Effect.forkIn(layerScope),
        );

      // Downloads the Whisper model if it is missing, so the first transcription doesn't wait.
      yield* transcriber.prepare.pipe(
        Effect.ignoreCause({ log: "Warn", message: "Could not prepare transcription" }),
        Effect.forkIn(layerScope),
      );

      // Its capture died with the app: finish it as it is, without a stop time.
      const crashed = yield* store.active;
      if (Option.isSome(crashed)) {
        yield* store.clear;
        const folder = yield* store.folder(crashed.value.id);
        if (Option.isSome(folder)) yield* finishInBackground(folder.value, false);
      }

      const start = Effect.gen(function* () {
        const active = yield* SubscriptionRef.get(current);
        if (Option.isSome(active)) {
          return yield* new RecordingAlreadyActive({ activeSessionId: active.value.id });
        }
        // Inside the permit, so a second start waits for this one's permission prompt.
        yield* requireScreenCapture.pipe(Effect.provideService(ScreenCapture, capture));
        const recording = new RecordingSession({
          id: yield* ids.recordingSessionId,
          startedAt: yield* DateTime.now,
        });
        const folder = yield* store.save(recording);
        const scope = yield* Scope.make();
        const handle = yield* sessionCapture.start(folder).pipe(
          Scope.provide(scope),
          // Nothing records, so nothing may look active; the folder is kept and finished.
          Effect.onError((cause) =>
            Effect.all([
              Scope.close(scope, Exit.failCause(cause)),
              store.clear,
              finishInBackground(folder, true),
            ]),
          ),
        );
        yield* Ref.set(running, Option.some({ folder, handle, scope }));
        yield* SubscriptionRef.set(current, Option.some(recording));
        yield* askForAccessibility.pipe(
          Effect.provideService(FocusTracker, focus),
          Semaphore.withPermitsIfAvailable(asking, 1),
          Effect.forkIn(layerScope),
        );
        return recording;
      }).pipe(exclusive, Effect.withSpan("Recordings.start"));

      const stop = Effect.gen(function* () {
        const stopped = yield* Effect.gen(function* () {
          const active = yield* SubscriptionRef.get(current);
          if (Option.isNone(active)) return yield* new NoActiveRecording({});
          yield* store.clear;
          yield* SubscriptionRef.set(current, Option.none());
          // Inside the permit, so a new recording can't start before this capture has stopped.
          const capturing = yield* Ref.getAndSet(running, Option.none());
          if (Option.isSome(capturing)) {
            const { folder, handle, scope } = capturing.value;
            yield* handle.stop.pipe(
              Effect.catchTag("ScreenCaptureFailed", (error) =>
                Effect.logWarning("The session capture did not stop cleanly", error.reason),
              ),
            );
            yield* Scope.close(scope, Exit.void);
            yield* finishInBackground(folder, true);
          }
          return active.value;
        }).pipe(exclusive);
        yield* logging.open;
        return stopped;
      }).pipe(Effect.withSpan("Recordings.stop"));

      return Recordings.of({
        start,
        stop,
        active: SubscriptionRef.get(current),
        changes: SubscriptionRef.changes(current),
      });
    }),
  );
}
