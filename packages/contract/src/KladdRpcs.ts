import {
  ClickThroughWindow,
  ClosableWindow,
  LoggingOverlayState,
  OpenableWindow,
  PastSession,
  PillDock,
  Point,
  ScreenshotId,
  ScreenshotSlot,
  ScreenshotTray,
  Session,
  SummaryStatus,
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
  /**
   * The ended session's summary, which the logging overlay's chat shows: being written, written or
   * failed (null without an ended session), then every change.
   */
  Rpc.make("WatchSummary", {
    success: Schema.NullOr(SummaryStatus),
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
  /** The logging-mode pill's star: opens the logging overlay on its chat, or closes it. */
  Rpc.make("ToggleLoggingOverlay"),
  /** The logging-mode pill's gear: swaps the overlay between chat and the log's settings. */
  Rpc.make("ToggleLogSettings"),
  /** The logging overlay now, then every change. */
  Rpc.make("WatchLoggingOverlay", {
    success: LoggingOverlayState,
    stream: true,
  }),
  /**
   * Gives keyboard focus back to the app the student writes in, after they typed in the logging
   * overlay's composer. The overlay stays open.
   */
  Rpc.make("ReturnFocus"),
  /** Pops up the pill's native menu: the session's actions and capture mode, Settings, Quit. */
  Rpc.make("OpenPillMenu"),
  /** The screenshot in flight and the attached ones, then every change. ⌃⇧C takes one. */
  Rpc.make("WatchScreenshots", {
    success: ScreenshotTray,
    stream: true,
  }),
  /** The flight window's screenshot has dropped into the pill. */
  Rpc.make("LandScreenshot", { payload: { id: ScreenshotId } }),
  /**
   * Where the pill's notch rests, which the logging overlay grows out of; null while it moves. The
   * pill sends it whenever it comes to rest or starts moving.
   */
  Rpc.make("SetPillDock", { payload: { dock: Schema.NullOr(PillDock) } }),
  /** Where a ⌃⇧C screenshot can land in the pill's tray. The pill sends it whenever it comes to rest. */
  Rpc.make("SetScreenshotSlot", { payload: { slot: ScreenshotSlot } }),
  Rpc.make("ShowWindow", { payload: { kind: OpenableWindow } }),
  Rpc.make("HideWindow", { payload: { kind: ClosableWindow } }),
  /** Moves the pill window's top-left corner to `position` at once: the UI is dragging the pill. */
  Rpc.make("MovePill", { payload: { position: Point } }),
  /**
   * Whether clicks on a window pass through to the apps below. The window is larger than what it
   * draws (the notch, the overlay's panel), so the UI turns this off only while the pointer is over it.
   */
  Rpc.make("SetClickThrough", {
    payload: { kind: ClickThroughWindow, clickThrough: Schema.Boolean },
  }),
) {}
