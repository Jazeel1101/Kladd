import { Ids } from "@kladd/core";
import { RecordingSessionId, ScreenshotId } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { SecureRandom } from "effect/crypto";

/** UUIDv7 IDs: unique and sortable by creation time. */
export const IdsLive = Layer.succeed(
  Ids,
  Ids.of({
    recordingSessionId: Effect.sync(() => RecordingSessionId.make(SecureRandom.uuidV7Unsafe())),
    screenshotId: Effect.sync(() => ScreenshotId.make(SecureRandom.uuidV7Unsafe())),
  }),
);
