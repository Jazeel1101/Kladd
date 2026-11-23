/**
 * Test doubles for every port in ../ports. Use these instead of writing mocks in a test.
 * Adding a port? Add its test layer here in the same PR.
 */
import {
  RecordingSessionId,
  ScreenCapturePermissionDenied,
  type RecordingSession,
} from "@kladd/domain";
import { Effect, Layer, Option, Ref } from "effect";
import { Ids } from "../ports/Ids";
import { RecordingStore } from "../ports/RecordingStore";
import { ScreenCapture } from "../ports/ScreenCapture";

export const ScreenCaptureTest = {
  granted: Layer.succeed(ScreenCapture, ScreenCapture.of({ start: Effect.void })),
  denied: Layer.succeed(
    ScreenCapture,
    ScreenCapture.of({ start: Effect.fail(new ScreenCapturePermissionDenied({})) }),
  ),
};

/** In-memory store. Starts empty. */
export const RecordingStoreTest = Layer.effect(
  RecordingStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(Option.none<RecordingSession>());
    return RecordingStore.of({
      active: Ref.get(ref),
      save: (session) => Ref.set(ref, Option.some(session)),
    });
  }),
);

/** Returns "session-1", "session-2", ... */
export const IdsTest = Layer.effect(
  Ids,
  Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    return Ids.of({
      recordingSessionId: Ref.updateAndGet(counter, (n) => n + 1).pipe(
        Effect.map((n) => RecordingSessionId.make(`session-${n}`)),
      ),
    });
  }),
);
