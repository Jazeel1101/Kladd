import { KladdRpcs } from "@kladd/contract";
import { LoggingOverlay, OverlayWindows, Recordings } from "@kladd/core";
import { Effect, Option, Stream } from "effect";
import { PillMenu } from "../pillMenu";

/**
 * Maps each Rpc in @kladd/contract to a core use case. Keep handlers thin:
 * no logic here, only translation between the wire shape and core.
 */
export const RpcHandlersLive = KladdRpcs.toLayer(
  Effect.gen(function* () {
    const recordings = yield* Recordings;
    const logging = yield* LoggingOverlay;
    const windows = yield* OverlayWindows;
    const pillMenu = yield* PillMenu;
    return {
      WatchRecording: () => Stream.map(recordings.changes, Option.getOrNull),
      WatchLoggingOverlay: () => logging.changes,
      OpenPillMenu: () => pillMenu.open,
      ShowWindow: ({ kind }) => windows.show(kind),
      HideWindow: ({ kind }) => windows.hide(kind),
    };
  }),
);
