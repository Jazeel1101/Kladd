import {
  ClosableWindow,
  LoggingOverlayInfo,
  OpenableWindow,
  RecordingSession,
  ScreenshotId,
  ScreenshotTray,
} from "@kladd/domain";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * Every call the UI can make to the main process.
 * Add an Rpc here, then implement it in apps/desktop/src/main/rpc/handlers.ts.
 * Payload, success and error must be schemas from @kladd/domain (or plain Schema), never classes from core.
 */
export class KladdRpcs extends RpcGroup.make(
  /** The active recording, then every change to it. Starting and stopping happen in the pill menu. */
  Rpc.make("WatchRecording", {
    success: Schema.NullOr(RecordingSession),
    stream: true,
  }),
  /** What the logging overlay was last opened for (null before), then every later open. */
  Rpc.make("WatchLoggingOverlay", {
    success: Schema.NullOr(LoggingOverlayInfo),
    stream: true,
  }),
  /** Pops up the pill's native menu: start/stop recording, show the logging overlay, Settings, Quit. */
  Rpc.make("OpenPillMenu"),
  /** The screenshot in flight and the ones in the logging overlay's tray, then every change. ⌃⇧C takes one. */
  Rpc.make("WatchScreenshots", {
    success: ScreenshotTray,
    stream: true,
  }),
  /** The flight window's screenshot reached the tray. */
  Rpc.make("LandScreenshot", { payload: { id: ScreenshotId } }),
  Rpc.make("ShowWindow", { payload: { kind: OpenableWindow } }),
  Rpc.make("HideWindow", { payload: { kind: ClosableWindow } }),
) {}
