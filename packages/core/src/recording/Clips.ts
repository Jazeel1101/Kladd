import type { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import {
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Scope,
  Semaphore,
} from "effect";
import { ClipCapture, type ClipCaptureHandle } from "../ports/ClipCapture";
import { RecordingStore } from "../ports/RecordingStore";
import { Transcriber } from "../ports/Transcriber";

/** The clip being recorded. */
interface Running {
  readonly folder: string;
  readonly handle: ClipCaptureHandle;
  readonly scope: Scope.Closeable;
}

/** The active work session: its folder, and done once end is called, which cancels a clip start. */
interface Session {
  readonly folder: string;
  readonly ending: Deferred.Deferred<void>;
}

/**
 * Use case: start and stop clips (GLOSSARY: "klipp") inside the active work session, each in its
 * own folder in the session folder, and transcribe them after they stop. Recordings tells it when
 * a session begins and ends; without one, toggle does nothing.
 */
export class Clips extends Context.Service<
  Clips,
  {
    /**
     * Starts a clip in the active session, or stops the one recording, then transcribes it in the
     * background. Does nothing without an active session. A clip whose capture fails to start, or
     * is cancelled by end before it records, is removed.
     */
    readonly toggle: Effect.Effect<void, ScreenCapturePermissionDenied | ScreenCaptureFailed>;
    /** For Recordings: the session writing `folder` is recording, so clips go into it. */
    readonly begin: (folder: string) => Effect.Effect<void>;
    /**
     * For Recordings, before the session capture stops: interrupts a clip still starting, stops a
     * recording one, without transcribing it (finishSession does), and takes no more clips until
     * the next begin.
     */
    readonly end: Effect.Effect<void>;
    /**
     * Transcribes every clip of a session folder that has sound and no transcript, and stores its
     * language. Skips the clip starting or recording. Waits for a transcription already running,
     * and skips a clip it finished. A failed transcription is logged, and leaves the clip
     * untranscribed.
     */
    readonly transcribe: (folder: string) => Effect.Effect<void>;
  }
>()("kladd/core/Clips") {
  static readonly layer = Layer.effect(
    Clips,
    Effect.gen(function* () {
      const capture = yield* ClipCapture;
      const store = yield* RecordingStore;
      const transcriber = yield* Transcriber;
      const session = yield* Ref.make(Option.none<Session>());
      const running = yield* Ref.make(Option.none<Running>());
      // The clip folder from createClip until it has stopped, which transcription leaves alone.
      const recording = yield* Ref.make(Option.none<string>());
      // Toggles, begin and end check, then change, the running clip; one at a time.
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));
      // One Whisper run at a time, so a clip is never transcribed twice at once.
      const whisper = Semaphore.withPermit(yield* Semaphore.make(1));
      const layerScope = yield* Effect.scope;

      const transcribeIn = Effect.fn("Clips.transcribe")(function* (folder: string, only?: string) {
        for (const clip of yield* store.untranscribed(folder)) {
          if (only !== undefined && clip.folder !== only) continue;
          if (Option.contains(yield* Ref.get(recording), clip.folder)) continue;
          yield* transcriber.transcribe(clip.audio, clip.transcript).pipe(
            Effect.flatMap((language) =>
              store.updateClip(clip.folder, (info) => ({ ...info, language })),
            ),
            Effect.catchTag("TranscriptionFailed", (error) =>
              Effect.logWarning("Could not transcribe the clip", error.reason),
            ),
          );
        }
      }, whisper);

      const markStopped = Effect.fn("Clips.markStopped")(function* (
        folder: string,
        stoppedAt: DateTime.Utc,
      ) {
        yield* store.updateClip(folder, (info) => ({ ...info, stoppedAt }));
        yield* Ref.set(recording, Option.none());
      });

      // Always stops: a capture that fails to finish is logged, and the clip kept as it is.
      const stopRunning = Effect.gen(function* () {
        const clip = yield* Ref.getAndSet(running, Option.none());
        if (Option.isNone(clip)) return Option.none<string>();
        const { folder, handle, scope } = clip.value;
        // The clip's files end at the stop request; the helper takes a moment to finish them.
        const stoppedAt = yield* DateTime.now;
        yield* handle.stop.pipe(
          Effect.catchTag("ScreenCaptureFailed", (error) =>
            Effect.logWarning("The clip capture did not stop cleanly", error.reason),
          ),
        );
        yield* Scope.close(scope, Exit.void);
        yield* markStopped(folder, stoppedAt);
        return Option.some(folder);
      });

      const toggle = Effect.gen(function* () {
        const active = yield* Ref.get(session);
        if (Option.isNone(active)) return;
        const { folder, ending } = active.value;
        const stopped = yield* stopRunning;
        if (Option.isSome(stopped)) {
          yield* transcribeIn(folder, stopped.value).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Could not transcribe the clip" }),
            Effect.forkIn(layerScope),
          );
          return;
        }
        const clip = yield* store.createClip(folder, {
          startedAt: yield* DateTime.now,
          stoppedAt: null,
          language: null,
        });
        yield* Ref.set(recording, Option.some(clip));
        const scope = yield* Scope.make();
        // A clip that never recorded is no clip: its folder goes, and the next one takes its name.
        const discard = (exit: Exit.Exit<unknown, unknown>) =>
          Scope.close(scope, exit).pipe(
            Effect.andThen(store.removeClip(clip)),
            Effect.andThen(Ref.set(recording, Option.none())),
          );
        // A start that never reports ready must not keep end, so the session's stop, waiting.
        const handle = yield* capture.start(clip).pipe(
          Scope.provide(scope),
          Effect.asSome,
          Effect.raceFirst(Effect.as(Deferred.await(ending), Option.none<ClipCaptureHandle>())),
          Effect.onError((cause) => discard(Exit.failCause(cause))),
        );
        if (Option.isNone(handle)) return yield* discard(Exit.void);
        // Times in the clip's files count from its first frame, which is about when start succeeds.
        const startedAt = yield* DateTime.now;
        yield* store.updateClip(clip, (info) => ({ ...info, startedAt }));
        yield* Ref.set(running, Option.some({ folder: clip, handle: handle.value, scope }));
      }).pipe(exclusive, Effect.withSpan("Clips.toggle"));

      return Clips.of({
        toggle,
        begin: (folder) =>
          Deferred.make<void>().pipe(
            Effect.flatMap((ending) => Ref.set(session, Option.some({ folder, ending }))),
            exclusive,
          ),
        // Outside the permit: a clip start holds it until it is ready or cancelled.
        end: Ref.get(session).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: ({ ending }) => Deferred.succeed(ending, undefined),
            }),
          ),
          Effect.andThen(
            stopRunning.pipe(Effect.andThen(Ref.set(session, Option.none())), exclusive),
          ),
        ),
        transcribe: (folder) => transcribeIn(folder),
      });
    }),
  );
}
