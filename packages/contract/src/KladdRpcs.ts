import {
  ClosableWindow,
  LoggingOverlayInfo,
  OpenableWindow,
  PastSession,
  Point,
  ScreenshotId,
  ScreenshotSlot,
  ScreenshotTray,
  Session,
} from "@kladd/domain";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

/**
 * Every call the UI can make to the main process.
 * Add an Rpc here, then implement it in apps/desktop/src/main/rpc/handlers.ts.
 * Payload, success and error must be schemas from @kladd/domain (or plain Schema), never classes from core.
 * The pill's actions fail in main, which shows the error, so they have no error here.
 */
export class KladdRpcs extends RpcGroup.make(
  /** The open session (active, or ended and waiting for its log; null without one), then every change. */
  Rpc.make("WatchSession", {
    success: Schema.NullOr(Session),
    stream: true,
  }),
  /** Every session that is not active, newest first, then again on every change. */
  Rpc.make("WatchPastSessions", {
    success: Schema.Array(PastSession),
    stream: true,
  }),
  /** When the clip recording now started (null without one), then every change. */
  Rpc.make("WatchClip", {
    success: Schema.NullOr(Schema.DateTimeUtc),
    stream: true,
  }),
  /** The idle pill's start button: starts a session in the mode chosen in the pill menu. */
  Rpc.make("StartSession"),
  /** Ends the active session; the pill turns to logging mode and the logging overlay opens. */
  Rpc.make("EndSession"),
  /** The logging-mode pill's checkmark: the log is written, and the pill turns idle. */
  Rpc.make("FinishLogging"),
  /** Like ⌃⇧C: a screenshot into the active session. */
  Rpc.make("TakeScreenshot"),
  /** Like ⌥⇧C: starts a clip in the active session, or stops the one recording. */
  Rpc.make("ToggleClip"),
  /** Opens the logging overlay again, next to where the user writes. */
  Rpc.make("OpenLoggingOverlay"),
  /** What the logging overlay was last opened for (null before), then every change while it is open. */
  Rpc.make("WatchLoggingOverlay", {
    success: Schema.NullOr(LoggingOverlayInfo),
    stream: true,
  }),
  /** Closes the logging overlay and stops following the app it was opened for. */
  Rpc.make("CloseLoggingOverlay"),
  /** Pops up the pill's native menu: the session's actions and capture mode, Settings, Quit. */
  Rpc.make("OpenPillMenu"),
  /** The screenshot in flight and the attached ones, then every change. ⌃⇧C takes one. */
  Rpc.make("WatchScreenshots", {
    success: ScreenshotTray,
    stream: true,
  }),
  /** The flight window's screenshot has dropped into the pill. */
  Rpc.make("LandScreenshot", { payload: { id: ScreenshotId } }),
  /** Where a ⌃⇧C screenshot can land in the pill's tray. The pill sends it whenever it comes to rest. */
  Rpc.make("SetScreenshotSlot", { payload: { slot: ScreenshotSlot } }),
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
