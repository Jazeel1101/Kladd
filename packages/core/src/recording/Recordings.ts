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
 * A folder left unfinished, such as by a crash or by a stop before the model was ready, is finished
 * when Kladd opens and once the model is ready; a crashed recording is not resumed.
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
      const finishInBackground = (folder: string) =>
        Effect.gen(function* () {
          const stoppedAt = yield* DateTime.now;
          yield* store.updateInfo(folder, (info) => ({ ...info, stoppedAt }));
          yield* finishSession(folder).pipe(
            Effect.provideService(RecordingStore, store),
            Effect.provideService(Transcriber, transcriber),
          );
        }).pipe(
          Effect.ignoreCause({ log: "Warn", message: "Could not finish the session folder" }),
          Effect.forkIn(layerScope),
        );

      // A folder is finished once it has overview.md, and transcript.jsonl if it has audio; nothing
      // else marks it, so a crash or quit before finishSession leaves it to the next launch. Each
      // runs once per launch: one that keeps failing waits for the next.
      const finishUnfinished = Effect.fn("Recordings.finishUnfinished")(function* (
        needsModel: boolean,
      ) {
        for (const folder of yield* store.unfinished) {
          // save marks a recording active before its capture starts.
          const active = yield* store.active;
          if (Option.isSome(active)) {
            const recording = yield* store.folder(active.value.id);
            if (Option.contains(recording, folder)) continue;
          }
          if (Option.isSome(yield* store.audio(folder)) !== needsModel) continue;
          yield* finishSession(folder).pipe(
            Effect.provideService(RecordingStore, store),
            Effect.provideService(Transcriber, transcriber),
            Effect.ignoreCause({ log: "Warn", message: "Could not finish the session folder" }),
          );
        }
      });

      // A recording a crash left active is no longer recording; it is finished below, as it is,
      // without a stop time.
      if (Option.isSome(yield* store.active)) yield* store.clear;
      yield* finishUnfinished(false).pipe(Effect.forkIn(layerScope));

      // Downloads the Whisper model if it is missing, then transcribes what was saved without it.
      yield* transcriber.prepare.pipe(
        Effect.andThen(finishUnfinished(true)),
        Effect.ignoreCause({ log: "Warn", message: "Could not prepare transcription" }),
        Effect.forkIn(layerScope),
      );

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
              finishInBackground(folder),
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
            yield* finishInBackground(folder);
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
