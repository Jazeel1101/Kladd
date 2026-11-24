// `kladd-capture session`: writes the live files of a session folder (opptaksmappe) until SIGINT,
// SIGTERM or stdin closing. File names and line shapes are the contract in
// packages/domain/src/SessionFolder.ts; docs/internals/session-capture.md has the why.
//
// `t` is seconds since the `start` event. Every part is best effort: a part that fails logs to
// stderr and the rest go on. Video and sound are clips' (Clip.swift), not the session's.

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

/// fseventsd hands a change to the watcher up to about a second after it happened, and
/// FSEventStreamFlushSync does not hurry it, so stop keeps watching this long.
let fileEventsGrace: TimeInterval = 1.5

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


// MARK: - Files

/// files.jsonl: each file changed under `root`, once, minus paths containing a denied fragment.
final class FileWatcher {
  private var stream: FSEventStreamRef?
  private var seen = Set<String>()
  private let denied: [String]
  private let changed: (String) -> Void

  init(root: String, denied: [String], changed: @escaping (String) -> Void) {
    self.denied = denied
    self.changed = changed
    var context = FSEventStreamContext(
      version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
    let callback: FSEventStreamCallback = { _, info, count, paths, flags, _ in
      guard let info else { return }
      let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
      let list = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as? [String] ?? []
      for index in 0..<min(count, list.count) {
        watcher.saw(list[index], flags: flags[index])
      }
    }
    stream = FSEventStreamCreate(
      nil, callback, &context, [root] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 1,
      FSEventStreamCreateFlags(
        kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer))
    guard let stream else {
      logError("cannot watch \(root)")
      return
    }
    FSEventStreamSetDispatchQueue(stream, .main)
    if !FSEventStreamStart(stream) { logError("cannot watch \(root)") }
  }

  private func saw(_ path: String, flags: FSEventStreamEventFlags) {
    guard flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemIsFile) != 0,
      !seen.contains(path), !denied.contains(where: path.contains),
      // Removed files, and the old name of a renamed one, are gone: nothing to read.
      FileManager.default.fileExists(atPath: path)
    else { return }
    seen.insert(path)
    changed(path)
  }

  /// Stops after `fileEventsGrace`, so changes made just before still arrive, then calls `done`.
  func stop(done: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + fileEventsGrace) {
      self.stopNow()
      done()
    }
  }

  private func stopNow() {
    guard let stream else { return }
    FSEventStreamStop(stream)
    FSEventStreamInvalidate(stream)
    FSEventStreamRelease(stream)
    self.stream = nil
  }
}

// MARK: - Session

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
  let timeline: LineWriter
  let files: LineWriter
  let accessibility = AXIsProcessTrusted()
  var watcher: FileWatcher?
  var timer: Timer?

  var start: CMTime?
  /// When `stop` was written: files that arrive during `fileEventsGrace` get this `t`.
  var end: CMTime?
  var stoppedAt: Date?
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

  let ocrQueue = DispatchQueue(label: "kladd.session.ocr", qos: .utility)
  let ocrJobs = DispatchGroup()

  init(dir: URL, privacy: PrivacyFilter) {
    self.dir = dir
    self.privacy = privacy
    for sub in ["frames", "focus"] {
      try? FileManager.default.createDirectory(at: dir.appendingPathComponent(sub), withIntermediateDirectories: true)
    }
    timeline = LineWriter(dir.appendingPathComponent("timeline.jsonl"))
    files = LineWriter(dir.appendingPathComponent("files.jsonl"))
  }

  func t(_ time: CMTime = hostNow()) -> Double {
    guard let start else { return 0 }
    return (time - start).seconds
  }

  // MARK: Start and stop

  func begin(deniedPaths: [String]) async {
    // Without a display (the Mac is locked) the session starts anyway; `tick` keeps trying, and
    // until then there are no keyframes.
    do { try await privacy.load() } catch { logError("no keyframes for now: \(error)") }
    privacy.watchLaunches()
    start = hostNow()
    timeline.write([
      "type": "start", "t": 0, "at": iso(Date()), "accessibility": accessibility,
    ])
    say("recording")
    keys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    clicks = clickCount()
    watcher = FileWatcher(root: NSHomeDirectory(), denied: deniedPaths) { [weak self] path in
      guard let self else { return }
      // After stop, only changes made before it are still let in (FSEvents delivers them late).
      if let stoppedAt = self.stoppedAt {
        let changed = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
        guard let changed, changed <= stoppedAt else { return }
      }
      self.files.write(["t": seconds(self.t(min(hostNow(), self.end ?? .positiveInfinity))), "path": path])
    }
    timer = Timer.scheduledTimer(withTimeInterval: focusPollInterval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    tick()
    if stopRequested { stop() }
  }

  /// Writes `stop`, then finishes file watching and OCR, and exits.
  func stop() {
    stopRequested = true
    guard start != nil, !stopping else { return }
    stopping = true
    privacy.stopped = true
    timer?.invalidate()
    focusFrame?.cancel()
    let end = hostNow()
    self.end = end
    stoppedAt = Date()
    timeline.write(["type": "stop", "t": seconds(t(end)), "at": iso(Date())])

    let done = DispatchGroup()
    if let watcher {
      done.enter()
      watcher.stop { done.leave() }
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

  func tick() {
    ticks += 1
    privacy.check()
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
    timeline.write(["type": "focus", "t": seconds(t()), "app": name, "bundleId": bundleId, "title": title ?? NSNull()])
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
      timeline.write(["type": "idle", "t": seconds(now)])
    } else if idle, since < idleAfter {
      idle = false
      timeline.write(["type": "active", "t": seconds(max(0, now - since))])
      keys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
      clicks = clickCount()
    }
    guard !idle, ticks % activityEvery == 0 else { return }
    let newKeys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    let newClicks = clickCount()
    timeline.write(["type": "activity", "t": seconds(now), "keys": newKeys &- keys, "clicks": newClicks &- clicks])
    keys = newKeys
    clicks = newClicks
  }

  // MARK: Keyframes

  func screenshot(width: Int? = nil, height: Int? = nil) async -> CGImage? {
    guard let filter = privacy.filter, let display = privacy.display else { return nil }
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
      timeline.write(["type": "frame", "t": seconds(now), "file": file, "reason": reason, "ocr": txt])
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
  requireGranted()
  let current = Session(
    dir: URL(fileURLWithPath: dir),
    privacy: PrivacyFilter(
      excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) },
      excludedApps: Set(stringList("--exclude-apps", in: args))))
  session = current
  stopOn { current.stop() }
  // The folder is <dataDir>/recordings/<session>: Kladd's own writes are not the student's work.
  let dataDir = URL(fileURLWithPath: dir).standardized.deletingLastPathComponent().deletingLastPathComponent()
  await current.begin(deniedPaths: stringList("--deny-paths", in: args) + [dataDir.path + "/"])
}
