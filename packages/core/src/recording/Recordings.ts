import {
  RecordingAlreadyActive,
  RecordingSession,
  type ScreenCapturePermissionDenied,
} from "@kladd/domain";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import { Ids } from "../ports/Ids";
import { RecordingStore } from "../ports/RecordingStore";
import { ScreenCapture } from "../ports/ScreenCapture";

/**
 * Use case: start and inspect recordings.
 * A use case depends on ports (../ports), never on infra or platform code.
 */
export class Recordings extends Context.Service<
  Recordings,
  {
    readonly start: Effect.Effect<
      RecordingSession,
      RecordingAlreadyActive | ScreenCapturePermissionDenied
    >;
    readonly active: Effect.Effect<Option.Option<RecordingSession>>;
  }
>()("kladd/core/Recordings") {
  static readonly layer = Layer.effect(
    Recordings,
    Effect.gen(function* () {
      const capture = yield* ScreenCapture;
      const store = yield* RecordingStore;
      const ids = yield* Ids;

      const start = Effect.gen(function* () {
        const current = yield* store.active;
        if (Option.isSome(current)) {
          return yield* new RecordingAlreadyActive({ activeSessionId: current.value.id });
        }
        yield* capture.start;
        const session = new RecordingSession({
          id: yield* ids.recordingSessionId,
          startedAt: yield* DateTime.now,
        });
        yield* store.save(session);
        return session;
      }).pipe(Effect.withSpan("Recordings.start"));

      return Recordings.of({ start, active: store.active });
    }),
  );
}
