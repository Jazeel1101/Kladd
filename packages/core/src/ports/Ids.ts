import type { RecordingSessionId, ScreenshotId } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: generates IDs, so tests get predictable ones. Implemented in packages/infra.
 * Test double: IdsTest in ../testing.
 */
export class Ids extends Context.Service<
  Ids,
  {
    readonly recordingSessionId: Effect.Effect<RecordingSessionId>;
    readonly screenshotId: Effect.Effect<ScreenshotId>;
  }
>()("kladd/core/Ids") {}
