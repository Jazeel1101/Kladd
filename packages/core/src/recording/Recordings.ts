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
  Layer,
  Option,
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

/**
 * Use case: start, stop and watch recordings. Stopping a recording starts logging mode.
 * A use case depends on ports (../ports) and other use cases, never on infra or platform code.
 */
export class Recordings extends Context.Service<
  Recordings,
  {
    /**
     * Asks for screen capture permission first if Kladd doesn't have it (required), then for
     * Accessibility (optional: it places the logging overlay next to the text).
     */
    readonly start: Effect.Effect<
      RecordingSession,
      RecordingAlreadyActive | ScreenCapturePermissionDenied | ScreenCaptureFailed
    >;
    /** Stops the active recording and opens the logging overlay. */
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
      const focus = yield* FocusTracker;
      const store = yield* RecordingStore;
      const ids = yield* Ids;
      const logging = yield* LoggingOverlay;
      const current = yield* SubscriptionRef.make(yield* store.active);
      // Start and stop check, then change, the active recording; one at a time so they can't interleave.
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));

      const start = Effect.gen(function* () {
        const active = yield* SubscriptionRef.get(current);
        if (Option.isSome(active)) {
          return yield* new RecordingAlreadyActive({ activeSessionId: active.value.id });
        }
        // Inside the permit, so a second start waits for this one's permission prompt.
        yield* requireScreenCapture.pipe(Effect.provideService(ScreenCapture, capture));
        yield* askForAccessibility.pipe(Effect.provideService(FocusTracker, focus));
        const session = new RecordingSession({
          id: yield* ids.recordingSessionId,
          startedAt: yield* DateTime.now,
        });
        yield* store.save(session);
        yield* SubscriptionRef.set(current, Option.some(session));
        return session;
      }).pipe(exclusive, Effect.withSpan("Recordings.start"));

      const stop = Effect.gen(function* () {
        const stopped = yield* Effect.gen(function* () {
          const active = yield* SubscriptionRef.get(current);
          if (Option.isNone(active)) return yield* new NoActiveRecording({});
          yield* store.clear;
          yield* SubscriptionRef.set(current, Option.none());
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
