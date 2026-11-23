import { KladdRpcs } from "@kladd/contract";
import { Recordings } from "@kladd/core";
import { Effect, Option } from "effect";

/**
 * Maps each Rpc in @kladd/contract to a core use case. Keep handlers thin:
 * no logic here, only translation between the wire shape and core.
 */
export const RpcHandlersLive = KladdRpcs.toLayer(
  Effect.gen(function* () {
    const recordings = yield* Recordings;
    return {
      StartRecording: () => recordings.start,
      GetActiveRecording: () => Effect.map(recordings.active, Option.getOrNull),
    };
  }),
);
