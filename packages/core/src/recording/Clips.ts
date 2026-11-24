import type { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import { Context, DateTime, Effect, Exit, Layer, Option, Ref, Scope, Semaphore } from "effect";
import { ClipCapture, type ClipCaptureHandle } from "../ports/ClipCapture";
import { RecordingStore } from "../ports/RecordingStore";
import { Transcriber } from "../ports/Transcriber";

/** The clip being recorded. */
interface Running {
  readonly folder: string;
  readonly handle: ClipCaptureHandle;
  readonly scope: Scope.Closeable;
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
     * background. Does nothing without an active session. A clip that fails to start is kept,
     * stopped, without its files.
     */
    readonly toggle: Effect.Effect<void, ScreenCapturePermissionDenied | ScreenCaptureFailed>;
    /** For Recordings: the session writing `folder` is recording, so clips go into it. */
    readonly begin: (folder: string) => Effect.Effect<void>;
    /**
     * For Recordings, before the session capture stops: stops a recording clip, without
     * transcribing it (finishSession does), and takes no more clips until the next begin.
     */
    readonly end: Effect.Effect<void>;
    /**
     * Transcribes every clip of a session folder that has sound and no transcript, and stores its
     * language. Waits for a transcription already running, and skips a clip it finished. A failed
     * transcription is logged, and leaves the clip untranscribed.
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
      const session = yield* Ref.make(Option.none<string>());
      const running = yield* Ref.make(Option.none<Running>());
      // Toggles, begin and end check, then change, the running clip; one at a time.
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));
      // One Whisper run at a time, so a clip is never transcribed twice at once.
      const whisper = Semaphore.withPermit(yield* Semaphore.make(1));
      const layerScope = yield* Effect.scope;

      const transcribeIn = Effect.fn("Clips.transcribe")(function* (folder: string, only?: string) {
        for (const clip of yield* store.untranscribed(folder)) {
          if (only !== undefined && clip.folder !== only) continue;
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

      const markStopped = Effect.fn("Clips.markStopped")(function* (folder: string) {
        const stoppedAt = yield* DateTime.now;
        yield* store.updateClip(folder, (info) => ({ ...info, stoppedAt }));
      });

      // Always stops: a capture that fails to finish is logged, and the clip kept as it is.
      const stopRunning = Effect.gen(function* () {
        const clip = yield* Ref.getAndSet(running, Option.none());
        if (Option.isNone(clip)) return Option.none<string>();
        const { folder, handle, scope } = clip.value;
        yield* handle.stop.pipe(
          Effect.catchTag("ScreenCaptureFailed", (error) =>
            Effect.logWarning("The clip capture did not stop cleanly", error.reason),
          ),
        );
        yield* Scope.close(scope, Exit.void);
        yield* markStopped(folder);
        return Option.some(folder);
      });

      const toggle = Effect.gen(function* () {
        const folder = yield* Ref.get(session);
        if (Option.isNone(folder)) return;
        const stopped = yield* stopRunning;
        if (Option.isSome(stopped)) {
          yield* transcribeIn(folder.value, stopped.value).pipe(
            Effect.ignoreCause({ log: "Warn", message: "Could not transcribe the clip" }),
            Effect.forkIn(layerScope),
          );
          return;
        }
        const clip = yield* store.createClip(folder.value, {
          startedAt: yield* DateTime.now,
          stoppedAt: null,
          language: null,
        });
        const scope = yield* Scope.make();
        const handle = yield* capture.start(clip).pipe(
          Scope.provide(scope),
          Effect.onError((cause) =>
            Effect.andThen(Scope.close(scope, Exit.failCause(cause)), markStopped(clip)),
          ),
        );
        yield* Ref.set(running, Option.some({ folder: clip, handle, scope }));
      }).pipe(exclusive, Effect.withSpan("Clips.toggle"));

      return Clips.of({
        toggle,
        begin: (folder) => Ref.set(session, Option.some(folder)).pipe(exclusive),
        end: stopRunning.pipe(Effect.andThen(Ref.set(session, Option.none())), exclusive),
        transcribe: (folder) => transcribeIn(folder),
      });
    }),
  );
}
