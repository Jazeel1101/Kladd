import { KladdRpcs } from "@kladd/contract";
import { Clips, LoggingOverlay, OverlayWindows, Screenshots, Sessions } from "@kladd/core";
import { Effect, Option, Stream } from "effect";
import { PillActions } from "../pillActions";
import { PillMenu } from "../pillMenu";

/**
 * Maps each Rpc in @kladd/contract to a core use case, or to a PillActions action, which shows its
 * error. Keep handlers thin: no logic here, only translation between the wire shape and core.
 */
export const RpcHandlersLive = KladdRpcs.toLayer(
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const clips = yield* Clips;
    const logging = yield* LoggingOverlay;
    const windows = yield* OverlayWindows;
    const screenshots = yield* Screenshots;
    const actions = yield* PillActions;
    const pillMenu = yield* PillMenu;
    return {
      WatchSession: () => Stream.map(sessions.changes, Option.getOrNull),
      WatchPastSessions: () => sessions.past,
      WatchSummary: () => sessions.summary,
      WatchClip: () => Stream.map(clips.changes, Option.getOrNull),
      StartSession: () => actions.start,
      EndSession: () => actions.end,
      FinishLogging: () => actions.finishLogging,
      TakeScreenshot: () => actions.screenshot,
      ToggleClip: () => actions.clip,
      ToggleLoggingOverlay: () => logging.toggle,
      ToggleLogSettings: () => logging.toggleSettings,
      WatchLoggingOverlay: () => logging.changes,
      ReturnFocus: () => logging.returnFocus,
      SetPillDock: ({ dock }) => logging.pillAt(dock),
      WatchScreenshots: () => screenshots.changes,
      LandScreenshot: ({ id }) => screenshots.land(id),
      SetScreenshotSlot: ({ slot }) => screenshots.aimAt(slot),
      OpenPillMenu: () => pillMenu.open,
      ShowWindow: ({ kind }) => windows.show(kind),
      HideWindow: ({ kind }) => windows.hide(kind),
      MovePill: ({ position }) => windows.moveTo("pill", position),
      SetClickThrough: ({ kind, clickThrough }) => windows.setClickThrough(kind, clickThrough),
    };
  }),
);
