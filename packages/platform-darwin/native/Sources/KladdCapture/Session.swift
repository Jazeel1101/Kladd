// `kladd-capture session`: the capture of a work session (økt) until SIGINT, SIGTERM or stdin
// closing. It records clips (Clip.swift) and takes screenshots on the commands it reads from stdin,
// and in auto mode writes the live files of the session folder (opptaksmappe) too. File names and
// line shapes are the contract in packages/domain/src/SessionFolder.ts;
// docs/internals/session-capture.md has the why, main.swift the commands and answers.
//
// `t` is seconds since the `start` event. Every part is best effort: a part that fails logs to
// stderr and the rest go on. Video and sound are clips', not the session's.

import AppKit
import CoreMedia
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

let focusPollInterval: TimeInterval = 1
/// A keyframe this long after the last focus change, once the new window has drawn.
let focusFrameDelay: TimeInterval = 0.5
/// How often the screen is compared with the last keyframe.
let changeCheckEvery = 5
/// The least time between two keyframes saved for a screen change.
let changeFrameGap: Double = 10
let idleAfter: Double = 60
let activityEvery = 10
/// The thumbnail compared for screen changes, and what counts as a noticeable change: this share
/// of its pixels moved by more than `changePixelDelta` of 255.
let thumbWidth = 128
let thumbHeight = 80
let changePixelDelta = 24
let changeShare = 0.01
/// How long stop waits for OCR still running; a frame whose OCR has not finished has no text file.
let ocrStopWait: TimeInterval = 10

func writeJPEG(_ image: CGImage, to url: URL) -> Bool {
  guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
  else { return false }
  CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
  return CGImageDestinationFinalize(destination)
}

/// Vision OCR, accurate mode (fast mode loses æøå). Nil when it fails.
func recognizeText(_ image: CGImage) -> String? {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["nb-NO", "nn-NO", "en-US"]
  request.usesLanguageCorrection = true
  do {
    try VNImageRequestHandler(cgImage: image).perform([request])
  } catch {
    logError("OCR failed: \(error)")
    return nil
  }
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

/// The image as `thumbWidth` x `thumbHeight` grayscale bytes.
func grayscale(_ image: CGImage) -> [UInt8]? {
  var pixels = [UInt8](repeating: 0, count: thumbWidth * thumbHeight)
  let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
    guard let context = CGContext(
      data: buffer.baseAddress, width: thumbWidth, height: thumbHeight, bitsPerComponent: 8,
      bytesPerRow: thumbWidth, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { return false }
    context.draw(image, in: CGRect(x: 0, y: 0, width: thumbWidth, height: thumbHeight))
    return true
  }
  return drawn ? pixels : nil
}

func changedNoticeably(_ a: [UInt8], _ b: [UInt8]) -> Bool {
  let moved = zip(a, b).reduce(0) { $0 + (abs(Int($1.0) - Int($1.1)) > changePixelDelta ? 1 : 0) }
  return Double(moved) / Double(a.count) > changeShare
}

// MARK: - Session

/// What the running session reads from stdin: one command per line. A path is absolute, the rest
/// of the line, spaces and all.
enum SessionCommand: Equatable {
  /// `clip-start <folder>`: starts a clip in the folder, which exists.
  case clipStart(URL)
  /// `clip-stop`: stops the clip that is starting or recording.
  case clipStop
  /// `screenshot <file.png>`: saves the main display there.
  case screenshot(URL)

  init?(_ line: String) {
    if line == "clip-stop" {
      self = .clipStop
      return
    }
    for (prefix, make) in [("clip-start ", SessionCommand.clipStart), ("screenshot ", SessionCommand.screenshot)] {
      guard line.hasPrefix(prefix) else { continue }
      let path = String(line.dropFirst(prefix.count))
      guard path.hasPrefix("/") else { return nil }
      self = make(URL(fileURLWithPath: path))
      return
    }
    return nil
  }
}

/// Reads the focused element's subrole: a password field means no keyframe.
func secureFieldFocused(_ app: NSRunningApplication) -> Bool {
  guard AXIsProcessTrusted(),
    let element = childElement(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedUIElementAttribute)
  else { return false }
  return attribute(element, kAXSubroleAttribute) as? String == kAXSecureTextFieldSubrole
}

/// Runs on the main queue, apart from the OCR callbacks.
@MainActor final class Session {
  let dir: URL
  let privacy: PrivacyFilter
  var excludePid: pid_t? { privacy.excludePid }
  var excludedApps: Set<String> { privacy.excludedApps }
  /// Auto mode: keyframes, focus, input counts and the timeline. Manual mode writes none of them.
  let auto: Bool
  let timeline: LineWriter?
  let accessibility = AXIsProcessTrusted()
  var timer: Timer?

  var start: CMTime?
  var stopRequested = false
  var stopping = false

  var lastFocus: [String]?
  var focusFrame: DispatchWorkItem?
  var lastFrameT = -Double.infinity
  var lastThumb: [UInt8]?
  var capturingFrame = false
  var ticks = 0
  var idle = false
  var keys: UInt32 = 0
  var clicks: UInt32 = 0
  /// The clip starting or recording; one at a time.
  var clip: Clip?
  /// Called once the clip has ended: the session's stop waits for it.
  var clipEnded: (() -> Void)?

  let ocrQueue = DispatchQueue(label: "kladd.session.ocr", qos: .utility)
  let ocrJobs = DispatchGroup()

  init(dir: URL, privacy: PrivacyFilter, auto: Bool) {
    self.dir = dir
    self.privacy = privacy
    self.auto = auto
    guard auto else {
      timeline = nil
      return
    }
    for sub in ["frames", "focus"] {
      try? FileManager.default.createDirectory(at: dir.appendingPathComponent(sub), withIntermediateDirectories: true)
    }
    timeline = LineWriter(dir.appendingPathComponent("timeline.jsonl"))
  }

  func t(_ time: CMTime = hostNow()) -> Double {
    guard let start else { return 0 }
    return (time - start).seconds
  }

  // MARK: Start and stop

  func begin() async {
    // Without a display (the Mac is locked) the session starts anyway; `tick` keeps trying, and
    // until then there are no keyframes.
    do { try await privacy.load() } catch { logError("no keyframes for now: \(error)") }
    privacy.watchLaunches()
    start = hostNow()
    timeline?.write([
      "type": "start", "t": 0, "at": iso(Date()), "accessibility": accessibility,
    ])
    say("recording")
    keys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    clicks = clickCount()
    timer = Timer.scheduledTimer(withTimeInterval: focusPollInterval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    tick()
    if stopRequested { stop() }
  }

  // MARK: Commands

  /// One line from stdin. A clip answers `clip-recording` once it has its first frame, then
  /// `clip-stopped` or `clip-failed <reason>` once it has ended; a clip that ends before its first
  /// frame answers only `clip-failed`. A screenshot answers `screenshot-saved <file>` or
  /// `screenshot-failed <file>` (the reason goes to stderr). This process is the only
  /// ScreenCaptureKit user while it runs, so the ⌃⇧C screenshot is taken here too.
  func command(_ line: String) {
    guard let command = SessionCommand(line) else { return logError("unknown command: \(line)") }
    switch command {
    case .screenshot(let url):
      Task { @MainActor in
        guard let image = await screenshot(), writePNG(image, to: url) else {
          logError("cannot save the screenshot \(url.path)")
          return say("screenshot-failed \(url.path)")
        }
        say("screenshot-saved \(url.path)")
      }
    case .clipStart(let dir):
      guard !stopping else { return say("clip-failed the session is stopping") }
      // The caller waits for a clip's end before it starts the next one.
      guard clip == nil else { return logError("a clip is already recording; ignored \(line)") }
      let started = Clip(
        dir: dir, privacy: privacy, recording: { say("clip-recording") },
        ended: { [weak self] failure in self?.ended(clip: failure) })
      clip = started
      started.begin()
    case .clipStop:
      guard let clip else { return logError("no clip to stop") }
      clip.stop()
    }
  }

  private func ended(clip failure: String?) {
    if let failure { logError("clip failed: \(failure)") }
    say(failure.map { "clip-failed \($0)" } ?? "clip-stopped")
    clip = nil
    clipEnded?()
    clipEnded = nil
  }

  /// Writes `stop`, then finishes the clip and OCR, and exits.
  func stop() {
    stopRequested = true
    guard start != nil, !stopping else { return }
    stopping = true
    privacy.stopped = true
    timer?.invalidate()
    focusFrame?.cancel()
    let end = hostNow()
    timeline?.write(["type": "stop", "t": seconds(t(end)), "at": iso(Date())])

    let done = DispatchGroup()
    if let clip {
      done.enter()
      clipEnded = { done.leave() }
      clip.stop()
    }
    done.enter()
    DispatchQueue.global().async {
      _ = self.ocrJobs.wait(timeout: .now() + ocrStopWait)
      done.leave()
    }
    done.notify(queue: .main) { exit(0) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fail("session did not finish") }
  }

  // MARK: Every second

  func clickCount() -> UInt32 {
    CGEventSource.counterForEventType(.combinedSessionState, eventType: .leftMouseDown)
      &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: .rightMouseDown)
  }

  /// Manual mode keeps only the privacy filter current, for clips and screenshots.
  func tick() {
    ticks += 1
    privacy.check()
    guard auto else { return }
    trackFocus()
    trackInput()
    if ticks % changeCheckEvery == 0 { checkScreenChange() }
  }

  func trackFocus() {
    let front = userApp(excludePid: excludePid)
    guard let front, let bundleId = front.bundleIdentifier else { return }
    let name = front.localizedName ?? bundleId
    // An excluded app's window title (a conversation, a vault) is as private as its window.
    let title = excludedApps.contains(bundleId) ? nil : (focusSnapshot(of: front)["title"] as? String)
    let key = [bundleId, name, title ?? ""]
    guard key != lastFocus else { return }
    lastFocus = key
    timeline?.write(["type": "focus", "t": seconds(t()), "app": name, "bundleId": bundleId, "title": title ?? NSNull()])
    // Without Accessibility, keyframes come from screen changes only.
    guard accessibility else { return }
    focusFrame?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.saveKeyframe(reason: "focus") }
    focusFrame = work
    DispatchQueue.main.asyncAfter(deadline: .now() + focusFrameDelay, execute: work)
  }

  func trackInput() {
    let since = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    let now = t()
    if !idle, since >= idleAfter {
      idle = true
      timeline?.write(["type": "idle", "t": seconds(now)])
    } else if idle, since < idleAfter {
      idle = false
      timeline?.write(["type": "active", "t": seconds(max(0, now - since))])
      keys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
      clicks = clickCount()
    }
    guard !idle, ticks % activityEvery == 0 else { return }
    let newKeys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    let newClicks = clickCount()
    timeline?.write(["type": "activity", "t": seconds(now), "keys": newKeys &- keys, "clicks": newClicks &- clicks])
    keys = newKeys
    clicks = newClicks
  }

  // MARK: Keyframes

  /// The main display through the privacy filter, at full resolution unless a size is given.
  func screenshot(width: Int? = nil, height: Int? = nil) async -> CGImage? {
    guard let filter = privacy.filter, let display = privacy.display else {
      logError("screenshot failed: no display to capture")
      return nil
    }
    let config = pixelConfiguration(for: display)
    if let width, let height {
      config.width = width
      config.height = height
    }
    config.showsCursor = false
    do {
      return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    } catch {
      logError("screenshot failed: \(error)")
      return nil
    }
  }

  func checkScreenChange() {
    guard !idle, !capturingFrame, !privacy.pending, t() - lastFrameT >= changeFrameGap else { return }
    Task { @MainActor in
      guard let image = await screenshot(width: thumbWidth, height: thumbHeight), let thumb = grayscale(image)
      else { return }
      if let lastThumb, !changedNoticeably(lastThumb, thumb) { return }
      saveKeyframe(reason: "change")
    }
  }

  /// Whether a keyframe now could show what Kladd leaves out: an excluded app not yet filtered
  /// out, a password field, or an excluded app in front.
  func privateOnScreen() -> Bool {
    if privacy.pending { return true }
    guard let front = userApp(excludePid: excludePid) else { return false }
    return excludedApps.contains(front.bundleIdentifier ?? "") || secureFieldFocused(front)
  }

  /// A full-resolution keyframe, its focus snapshot, and OCR after it. No keyframe while idle or
  /// `privateOnScreen`, or when one already has this second's name. The `frame` event is written
  /// with the JPEG, so a crash during OCR (which can take minutes) still leaves it on the timeline.
  func saveKeyframe(reason: String) {
    guard !stopping, !idle, !capturingFrame, !privateOnScreen() else { return }
    // Rounded like the event's `t`, so the file is always named after it.
    let now = (t() * 1000).rounded() / 1000
    let name = String(format: "%06d", Int(now.rounded(.down)))
    let file = "frames/\(name).jpg"
    let url = dir.appendingPathComponent(file)
    guard !FileManager.default.fileExists(atPath: url.path) else { return }
    capturingFrame = true
    let focus = focusSnapshot(of: userApp(excludePid: excludePid))
    Task { @MainActor in
      defer { capturingFrame = false }
      guard let image = await screenshot() else { return logError("cannot save \(file)") }
      // Focus can move into a password field or an excluded app while the screenshot is taken.
      guard !stopping, !privateOnScreen() else { return }
      guard writeJPEG(image, to: url) else { return logError("cannot save \(file)") }
      lastFrameT = now
      lastThumb = grayscale(image)
      if let data = try? JSONSerialization.data(withJSONObject: focus, options: jsonOptions) {
        try? data.write(to: dir.appendingPathComponent("focus/\(name).json"))
      }
      let txt = "frames/\(name).txt"
      timeline?.write(["type": "frame", "t": seconds(now), "file": file, "reason": reason, "ocr": txt])
      ocrJobs.enter()
      ocrQueue.async {
        defer { self.ocrJobs.leave() }
        // Atomic: a text file that exists is complete.
        guard let text = recognizeText(image) else { return }
        try? Data(text.utf8).write(to: self.dir.appendingPathComponent(txt), options: .atomic)
      }
    }
  }
}

var session: Session?

@MainActor func runSession(_ args: [String]) async {
  guard let dir = option("--dir", in: args) else { fail("session needs --dir <folder>", code: exitUsage) }
  guard let mode = option("--mode", in: args), ["manual", "auto"].contains(mode) else {
    fail("session needs --mode manual|auto", code: exitUsage)
  }
  requireGranted()
  let current = Session(
    dir: URL(fileURLWithPath: dir),
    privacy: PrivacyFilter(
      excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) },
      excludedApps: Set(stringList("--exclude-apps", in: args))),
    auto: mode == "auto")
  session = current
  stopOn({ current.stop() }, commands: { current.command($0) })
  await current.begin()
}
