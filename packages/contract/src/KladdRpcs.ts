import {
  ClosableWindow,
  LoggingOverlayInfo,
  OpenableWindow,
  Point,
  RecordingSession,
  Rect,
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
  /** The screenshot in flight and the attached ones, then every change. ⌃⇧C takes one. */
  Rpc.make("WatchScreenshots", {
    success: ScreenshotTray,
    stream: true,
  }),
  /** The flight window's screenshot has dropped into the pill. */
  Rpc.make("LandScreenshot", { payload: { id: ScreenshotId } }),
  /**
   * Where a ⌃⇧C screenshot lands in the pill once it opens to take it in, in screen points. The
   * pill sends it whenever it comes to rest.
   */
  Rpc.make("SetScreenshotSlot", { payload: { slot: Rect } }),
  Rpc.make("ShowWindow", { payload: { kind: OpenableWindow } }),
  Rpc.make("HideWindow", { payload: { kind: ClosableWindow } }),
  /** Moves the pill window's top-left corner to `position` at once: the UI is dragging the pill. */
  Rpc.make("MovePill", { payload: { position: Point } }),
  /**
   * Whether clicks on the pill window pass through to the apps below. The window is larger than the
   * notch, so the UI turns this off only while the pointer is over the notch.
   */
  Rpc.make("SetPillClickThrough", { payload: { clickThrough: Schema.Boolean } }),
) {}
