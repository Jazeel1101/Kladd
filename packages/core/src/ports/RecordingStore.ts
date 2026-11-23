import type { RecordingSession } from "@kladd/domain";
import { Context, type Effect, type Option } from "effect";

/**
 * Port: persists recording sessions. Implemented in packages/infra.
 * Test double: RecordingStoreTest in ../testing.
 */
export class RecordingStore extends Context.Service<
  RecordingStore,
  {
    readonly active: Effect.Effect<Option.Option<RecordingSession>>;
    readonly save: (session: RecordingSession) => Effect.Effect<void>;
  }
>()("kladd/core/RecordingStore") {}
