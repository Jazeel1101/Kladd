// kladd-capture: Kladd's macOS helper for screen capture and focus. ScreenCaptureDarwin and
// FocusTrackerDarwin (../../src) run it as a child of Kladd, so macOS attributes screen recording
// and Accessibility permission to Kladd itself.
//
//   kladd-capture status                                  screen recording: prints "granted" or "denied"
//   kladd-capture request --app <Kladd.app> [--timeout s] guides the user to grant it, prints the result
//   kladd-capture screenshot --out <file.png> [--exclude-pid pid]
//   kladd-capture record --out <file.mov> [--exclude-pid pid]
//       prints "recording" once frames are written; stops on SIGINT, SIGTERM or stdin closing.
//   kladd-capture accessibility-status                    Accessibility: prints "granted" or "denied"
//   kladd-capture accessibility-request --app <Kladd.app> [--timeout s]
//   kladd-capture focus [--exclude-pid pid]               prints a FocusSnapshot as JSON (Focus.swift)
//   kladd-capture watch-focus [--exclude-pid pid]
//       prints a FocusSnapshot line now and on each change in that app; ends when it quits or stdin closes.
//
// Exit codes: 0 done, 77 permission denied (also prints "denied"), 64 bad usage, 1 anything else.

import AppKit
import CoreGraphics
#if KLADD_PERMISSIONFLOW
import PermissionFlow
#endif
import ScreenCaptureKit
import UniformTypeIdentifiers

let exitDenied: Int32 = 77
let exitUsage: Int32 = 64

struct Failure: Error { let message: String }

func say(_ line: String) {
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data(("kladd-capture: " + message + "\n").utf8))
  exit(code)
}

func option(_ name: String, in args: [String]) -> String? {
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}

func requireGranted() {
  if !CGPreflightScreenCaptureAccess() {
    say("denied")
    exit(exitDenied)
  }
}

/// The main display, minus Kladd's own windows (the pill and overlays) when `excludePid` is given.
func mainDisplayFilter(excludePid: pid_t?) async throws -> (SCContentFilter, SCDisplay) {
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  let mainID = CGMainDisplayID()
  guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
  else { throw Failure(message: "no display to capture") }
  let excluded = content.applications.filter { $0.processID == excludePid }
  return (SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []), display)
}

/// Full pixel resolution of the display (points times backing scale).
func pixelConfiguration(for display: SCDisplay) -> SCStreamConfiguration {
  let config = SCStreamConfiguration()
  let mode = CGDisplayCopyDisplayMode(display.displayID)
  config.width = mode?.pixelWidth ?? display.width
  config.height = mode?.pixelHeight ?? display.height
  return config
}

// MARK: - Permission

enum PermissionPane { case screenRecording, accessibility }

#if KLADD_PERMISSIONFLOW
/// Opens System Settings on `pane` with PermissionFlow's panel to drag Kladd.app in. Returns how to close it.
@MainActor func showPermissionGuide(_ pane: PermissionPane, app: URL) -> () -> Void {
  let controller = PermissionFlow.makeController()
  controller.authorize(
    pane: pane == .screenRecording ? .screenRecording : .accessibility, suggestedAppURLs: [app])
  return { controller.closePanel() }
}
#else
/// Built without PermissionFlow (no Xcode): the system prompt, then System Settings on `pane`.
@MainActor func showPermissionGuide(_ pane: PermissionPane, app: URL) -> () -> Void {
  let anchor: String
  switch pane {
  case .screenRecording:
    _ = CGRequestScreenCaptureAccess()
    anchor = "Privacy_ScreenCapture"
  case .accessibility:
    _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    anchor = "Privacy_Accessibility"
  }
  if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
    NSWorkspace.shared.open(url)
  }
  return {}
}
#endif

/// Guides the user through granting `pane` in System Settings; `granted` reads the permission.
@MainActor func runRequest(_ args: [String], pane: PermissionPane, granted: @escaping () -> Bool) {
  if granted() {
    say("granted")
    exit(0)
  }
  guard let appPath = option("--app", in: args) else { fail("request needs --app <path to .app>", code: exitUsage) }
  let timeout = option("--timeout", in: args).flatMap(Double.init) ?? 300

  let closeGuide = showPermissionGuide(pane, app: URL(fileURLWithPath: appPath))

  var finished = false
  let finish: @MainActor () -> Void = {
    guard !finished else { return }
    finished = true
    closeGuide()
    say(granted() ? "granted" : "denied")
    exit(0)
  }
  // Done when the user grants it, closes PermissionFlow's panel (the only window this process
  // has), quits System Settings, or gives up.
  NotificationCenter.default.addObserver(
    forName: NSWindow.willCloseNotification, object: nil, queue: .main
  ) { _ in MainActor.assumeIsolated { finish() } }
  Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    MainActor.assumeIsolated { if granted() { finish() } }
  }
  NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
  ) { note in
    let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    if app?.bundleIdentifier == "com.apple.systempreferences" { MainActor.assumeIsolated { finish() } }
  }
  Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { _ in MainActor.assumeIsolated { finish() } }
}

// MARK: - Screenshot

func runScreenshot(_ args: [String]) async {
  guard let out = option("--out", in: args) else { fail("screenshot needs --out <file.png>", code: exitUsage) }
  requireGranted()
  do {
    let (filter, display) = try await mainDisplayFilter(excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) })
    let config = pixelConfiguration(for: display)
    config.showsCursor = false
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    let url = URL(fileURLWithPath: out)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw Failure(message: "cannot write \(out)") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw Failure(message: "cannot write \(out)") }
    exit(0)
  } catch {
    fail(String(describing: error))
  }
}

// MARK: - Video

final class Recorder: NSObject, SCStreamDelegate, SCRecordingOutputDelegate {
  var stream: SCStream?
  /// Both must be true before stopCapture works: startCapture returned, and the file has frames.
  var captureRunning = false
  var started = false
  var startedAt = Date()
  var stopRequested = false
  var stopping = false

  func start(out: String, excludePid: pid_t?) async throws {
    let (filter, display) = try await mainDisplayFilter(excludePid: excludePid)
    let config = pixelConfiguration(for: display)
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.showsCursor = true

    let output = SCRecordingOutputConfiguration()
    output.outputURL = URL(fileURLWithPath: out)
    output.outputFileType = .mov
    output.videoCodecType = .h264

    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addRecordingOutput(SCRecordingOutput(configuration: output, delegate: self))
    self.stream = stream
    try await stream.startCapture()
    captureRunning = true
    if stopRequested { stop() }
  }

  /// Stopping the stream finalizes the file; recordingOutputDidFinishRecording then exits.
  /// A stop that arrives before recording has started waits for it, so the file is always valid.
  /// Called on the main queue only.
  func stop() {
    stopRequested = true
    guard started, captureRunning, !stopping, let stream else { return }
    // Stopping right after the first frame leaves ReplayKit with no file (RPRecordingError -5822).
    let minimum = 1.0 - Date().timeIntervalSince(startedAt)
    if minimum > 0 {
      DispatchQueue.main.asyncAfter(deadline: .now() + minimum) { self.stop() }
      return
    }
    stopping = true
    // stopCapture can report the stream as already stopped once the file is finalized; the
    // recording output's delegate is what says the file is done. Exit anyway if it never does.
    stream.stopCapture { _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { fail("recording did not finish") }
    }
  }

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    DispatchQueue.main.async {
      say("recording")
      self.started = true
      self.startedAt = Date()
      if self.stopRequested { self.stop() }
    }
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    exit(0)
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    fail("recording failed: \(error)")
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    DispatchQueue.main.async {
      if !self.stopping { fail("capture stopped: \(error)") }
    }
  }
}

let recorder = Recorder()
var signalSources: [DispatchSourceSignal] = []

func runRecord(_ args: [String]) async {
  guard let out = option("--out", in: args) else { fail("record needs --out <file.mov>", code: exitUsage) }
  requireGranted()

  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { recorder.stop() }
    source.resume()
    signalSources.append(source)
  }
  // Stdin closing means Kladd went away: finish the file rather than leave it unreadable.
  Thread.detachNewThread {
    while readLine() != nil {}
    DispatchQueue.main.async { recorder.stop() }
  }

  do {
    try await recorder.start(out: out, excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) })
  } catch {
    fail(String(describing: error))
  }
}

// MARK: - Main

let args = Array(CommandLine.arguments.dropFirst())
let app = NSApplication.shared
// No Dock icon: PermissionFlow's floating panel (when built with it) is the only UI.
app.setActivationPolicy(.accessory)

Task { @MainActor in
  switch args.first {
  case "status":
    say(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
    exit(0)
  case "request":
    runRequest(args, pane: .screenRecording, granted: CGPreflightScreenCaptureAccess)
  case "accessibility-status":
    say(AXIsProcessTrusted() ? "granted" : "denied")
    exit(0)
  case "accessibility-request":
    runRequest(args, pane: .accessibility, granted: { AXIsProcessTrusted() })
  case "focus":
    printFocus(excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) })
    exit(0)
  case "watch-focus":
    watchFocus(excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) })
  case "screenshot":
    await runScreenshot(args)
  case "record":
    await runRecord(args)
  default:
    fail(
      "usage: kladd-capture status | request --app <path> | screenshot --out <file> | record --out <file>"
        + " | accessibility-status | accessibility-request --app <path> | focus [--exclude-pid pid]"
        + " | watch-focus [--exclude-pid pid]",
      code: exitUsage)
  }
}

app.run()
