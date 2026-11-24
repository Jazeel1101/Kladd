// `kladd-capture session`: writes the live files of a session folder (opptaksmappe) until SIGINT,
// SIGTERM or stdin closing. File names and line shapes are the contract in
// packages/domain/src/SessionFolder.ts; docs/internals/session-capture.md has the why.
//
// One clock: `t` is seconds since the first video frame, read from the host clock that
// ScreenCaptureKit stamps frames with, so `t` is also the video's (and the audio's) timestamp.
// Everything but the video is best effort: a part that fails logs to stderr and the rest go on.

import AppKit
import AVFoundation
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
/// Video: about 1080p at a few frames per second; screen text stays readable at this bitrate.
let videoMaxSize = CGSize(width: 1920, height: 1080)
let videoFps: Int32 = 6
let videoBitrate = 1_000_000
let audioBitrate = 64_000
/// Fragments make screen.mp4 and audio.m4a playable after a crash, up to the last fragment.
let fragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
/// How long stop waits for OCR still running; a frame whose OCR has not finished has no text file.
let ocrStopWait: TimeInterval = 10

/// fseventsd hands a change to the watcher up to about a second after it happened, and
/// FSEventStreamFlushSync does not hurry it, so stop keeps watching this long.
let fileEventsGrace: TimeInterval = 1.5

func hostNow() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

/// Readable for grep: no `\/` escapes, and seconds with exactly three decimals at most.
let jsonOptions: JSONSerialization.WritingOptions = [.sortedKeys, .withoutEscapingSlashes]

/// Seconds to the millisecond, as a number JSON prints exactly (a Double prints 0.17199999999999999).
func seconds(_ value: Double) -> NSDecimalNumber {
  let ms = (value * 1000).rounded()
  return NSDecimalNumber(mantissa: UInt64(abs(ms)), exponent: -3, isNegative: ms < 0)
}

func logError(_ message: String) {
  FileHandle.standardError.write(Data(("kladd-capture: " + message + "\n").utf8))
}

/// A JSON array of strings passed on the command line.
func stringList(_ name: String, in args: [String]) -> [String] {
  guard let raw = option(name, in: args) else { return [] }
  guard let list = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String] else {
    fail("\(name) needs a JSON array of strings", code: exitUsage)
  }
  return list
}

/// Appends JSON lines, one write per line, so a crash loses at most the line being written.
final class LineWriter {
  private let handle: FileHandle?
  private let lock = NSLock()

  init(_ url: URL) {
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    handle = try? FileHandle(forWritingTo: url)
    _ = try? handle?.seekToEnd()
    if handle == nil { logError("cannot write \(url.path)") }
  }

  func write(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: jsonOptions) else { return }
    lock.lock()
    defer { lock.unlock() }
    try? handle?.write(contentsOf: data + Data("\n".utf8))
  }
}

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

// MARK: - Video

/// screen.mp4: ScreenCaptureKit frames written by AVAssetWriter, fragmented so a crash keeps it.
final class SessionVideo: NSObject, SCStreamDelegate, SCStreamOutput {
  private let url: URL
  private let queue = DispatchQueue(label: "kladd.session.video")
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var lastTime = CMTime.invalid
  /// Frames taken before this host time are not written: infinite from when an excluded app
  /// launches until the stream has accepted a filter without it.
  private var writeFrom = CMTime.zero
  /// Shown again at stop: ScreenCaptureKit sends no frames while the screen is still.
  private var lastFrame: CMSampleBuffer?
  private var finished = false
  private(set) var stream: SCStream?
  /// Called once, on the video queue, with the host time of the first frame: t = 0.
  var onFirstFrame: (CMTime) -> Void = { _ in }
  /// Called on the main queue when the stream stops on its own (display gone, capture error).
  var onStreamStopped: () -> Void = {}

  init(url: URL) { self.url = url }

  func start(filter: SCContentFilter, display: SCDisplay) async throws {
    let full = pixelConfiguration(for: display)
    let scale = min(1, videoMaxSize.width / CGFloat(full.width), videoMaxSize.height / CGFloat(full.height))
    let config = SCStreamConfiguration()
    // H.264 wants even sizes.
    config.width = Int(CGFloat(full.width) * scale) & ~1
    config.height = Int(CGFloat(full.height) * scale) & ~1
    config.minimumFrameInterval = CMTime(value: 1, timescale: videoFps)
    config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    config.showsCursor = true
    config.queueDepth = 4
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try await stream.startCapture()
    self.stream = stream
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, !finished, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete
    else { return }
    append(sampleBuffer)
  }

  /// Writes one complete frame. Runs on the video queue.
  func append(_ sampleBuffer: CMSampleBuffer) {
    let time = sampleBuffer.presentationTimeStamp
    guard !finished, let pixels = sampleBuffer.imageBuffer, time >= writeFrom else { return }
    if writer == nil {
      guard startWriter(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels), at: time)
      else { return }
      onFirstFrame(time)
    }
    // An invalid CMTime compares greater than every valid one, so the first frame needs its own case.
    guard let input, input.isReadyForMoreMediaData, !lastTime.isValid || time > lastTime else { return }
    if input.append(sampleBuffer) {
      lastTime = time
      lastFrame = sampleBuffer
    }
  }

  private func startWriter(width: Int, height: Int, at time: CMTime) -> Bool {
    do {
      let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
      writer.movieFragmentInterval = fragmentInterval
      let input = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: width,
          AVVideoHeightKey: height,
          AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: videoBitrate,
            AVVideoExpectedSourceFrameRateKey: videoFps,
            AVVideoMaxKeyFrameIntervalDurationKey: 10,
          ],
        ])
      input.expectsMediaDataInRealTime = true
      writer.add(input)
      guard writer.startWriting() else { throw writer.error ?? Failure(message: "cannot start video") }
      writer.startSession(atSourceTime: time)
      self.writer = writer
      self.input = input
      return true
    } catch {
      fail("cannot write video: \(error)")
    }
  }

  /// Ends the file at `end` with the last frame again, so the video lasts until the recording
  /// stopped (endSession alone does not make players show it that long).
  func finish(at end: CMTime, done: @escaping (Error?) -> Void) {
    stream?.stopCapture { _ in }
    queue.async {
      self.finished = true
      guard let writer = self.writer, writer.status == .writing else { return done(self.writer?.error) }
      if let input = self.input, let last = self.lastFrame, end > self.lastTime, input.isReadyForMoreMediaData {
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: end, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
          allocator: nil, sampleBuffer: last, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
          sampleBufferOut: &copy)
        if let copy, input.append(copy) { self.lastTime = end }
      }
      self.lastFrame = nil
      self.input?.markAsFinished()
      // Ending at an invalid time (no frame was written) raises and aborts the helper.
      if self.lastTime.isValid { writer.endSession(atSourceTime: self.lastTime) }
      writer.finishWriting { done(writer.status == .completed ? nil : writer.error) }
    }
  }

  /// Calls `accepted` on the main queue once the stream uses `filter`.
  func update(_ filter: SCContentFilter, accepted: @escaping () -> Void) {
    stream?.updateContentFilter(filter) { error in
      if let error { return logError("cannot update the video filter: \(error)") }
      DispatchQueue.main.async(execute: accepted)
    }
  }

  /// Stops writing frames, from now on, until `release`.
  func hold() { queue.sync { writeFrom = .positiveInfinity } }

  /// Writes frames again, from those taken now on.
  func release() {
    let now = hostNow()
    queue.async { self.writeFrom = now }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    logError("video stopped: \(error)")
    DispatchQueue.main.async { self.onStreamStopped() }
  }
}

// MARK: - Audio

/// audio.m4a from the default microphone, starting at t = 0 (converted to the microphone's clock).
/// A microphone that starts late is padded with silence: players ignore the empty edit
/// AVAssetWriter would put there instead, which would shift speech against `t`.
final class SessionAudio: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private let url: URL
  private let capture = AVCaptureSession()
  private let queue = DispatchQueue(label: "kladd.session.audio")
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var start: CMTime?
  private var finished = false

  /// Nil without permission or a microphone.
  init?(url: URL) {
    self.url = url
    super.init()
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
      let device = AVCaptureDevice.default(for: .audio),
      let deviceInput = try? AVCaptureDeviceInput(device: device),
      capture.canAddInput(deviceInput)
    else { return nil }
    let output = AVCaptureAudioDataOutput()
    guard capture.canAddOutput(output) else { return nil }
    capture.addInput(deviceInput)
    capture.addOutput(output)
    output.setSampleBufferDelegate(self, queue: queue)
  }

  /// Starts the microphone. Samples are written once `begin` gives it t = 0.
  func run() { capture.startRunning() }

  func begin(at start: CMTime) { queue.async { self.start = start } }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard !finished, let start else { return }
    if writer == nil {
      guard let clock = capture.synchronizationClock, let format = sampleBuffer.formatDescription else { return }
      let zero = CMSyncConvertTime(start, from: CMClockGetHostTimeClock(), to: clock)
      // Samples from before t = 0.
      if sampleBuffer.presentationTimeStamp + sampleBuffer.duration <= zero { return }
      startWriter(at: zero, format: format)
      let gap = sampleBuffer.presentationTimeStamp - zero
      if gap.seconds > 0.01, let input, let pad = silence(from: zero, duration: gap, format: format) {
        input.append(pad)
      }
    }
    guard let writer, writer.status == .writing, let input, input.isReadyForMoreMediaData else { return }
    input.append(sampleBuffer)
  }

  private func silence(from time: CMTime, duration: CMTime, format: CMFormatDescription) -> CMSampleBuffer? {
    let pcm = AVAudioFormat(cmAudioFormatDescription: format)
    guard let buffer = AVAudioPCMBuffer(
        pcmFormat: pcm, frameCapacity: AVAudioFrameCount(min(duration.seconds, 60) * pcm.sampleRate))
    else { return nil }
    buffer.frameLength = buffer.frameCapacity
    for channel in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
      if let data = channel.mData { memset(data, 0, Int(channel.mDataByteSize)) }
    }
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: CMTimeScale(pcm.sampleRate)), presentationTimeStamp: time,
      decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    guard
      CMSampleBufferCreate(
        allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
        formatDescription: format, sampleCount: CMItemCount(buffer.frameLength), sampleTimingEntryCount: 1,
        sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample)
        == noErr, let sample,
      CMSampleBufferSetDataBufferFromAudioBufferList(
        sample, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0,
        bufferList: buffer.audioBufferList) == noErr
    else { return nil }
    return sample
  }

  private func startWriter(at time: CMTime, format: CMFormatDescription) {
    do {
      let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
      writer.movieFragmentInterval = fragmentInterval
      let rate = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee.mSampleRate ?? 48_000
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: rate,
          AVEncoderBitRateKey: audioBitrate,
        ],
        sourceFormatHint: format)
      input.expectsMediaDataInRealTime = true
      writer.add(input)
      guard writer.startWriting() else { throw writer.error ?? Failure(message: "cannot start audio") }
      writer.startSession(atSourceTime: time)
      self.writer = writer
      self.input = input
    } catch {
      logError("cannot write audio: \(error)")
      finished = true
    }
  }

  func finish(done: @escaping () -> Void) {
    capture.stopRunning()
    queue.async {
      self.finished = true
      guard let writer = self.writer, writer.status == .writing else { return done() }
      self.input?.markAsFinished()
      writer.finishWriting {
        if writer.status != .completed { logError("audio failed: \(String(describing: writer.error))") }
        done()
      }
    }
  }
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

/// Runs on the main queue, apart from the video, audio and OCR callbacks.
final class Session: @unchecked Sendable {
  let dir: URL
  let excludePid: pid_t?
  let excludedApps: Set<String>
  let timeline: LineWriter
  let files: LineWriter
  let video: SessionVideo
  let audio: SessionAudio?
  let accessibility = AXIsProcessTrusted()
  var display: SCDisplay?
  var filter: SCContentFilter?
  /// The pids the filter leaves out, to tell when an excluded app starts or quits.
  var filteredPids = Set<pid_t>()
  /// An excluded app launched and the stream may still show it: no video frames or keyframes.
  var filterPending = false
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

  init(dir: URL, excludePid: pid_t?, excludedApps: Set<String>) {
    self.dir = dir
    self.excludePid = excludePid
    self.excludedApps = excludedApps
    for sub in ["frames", "focus"] {
      try? FileManager.default.createDirectory(at: dir.appendingPathComponent(sub), withIntermediateDirectories: true)
    }
    timeline = LineWriter(dir.appendingPathComponent("timeline.jsonl"))
    files = LineWriter(dir.appendingPathComponent("files.jsonl"))
    video = SessionVideo(url: dir.appendingPathComponent("screen.mp4"))
    // Asking needs no answer now: the grant counts from the next recording.
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
      AVCaptureDevice.requestAccess(for: .audio) { _ in }
    }
    audio = SessionAudio(url: dir.appendingPathComponent("audio.m4a"))
  }

  func t(_ time: CMTime = hostNow()) -> Double {
    guard let start else { return 0 }
    return (time - start).seconds
  }

  static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  // MARK: Start and stop

  func begin(deniedPaths: [String]) async throws {
    let (filter, display) = try await currentFilter()
    self.filter = filter
    self.display = display
    video.onStreamStopped = { [weak self] in self?.restartVideo() }
    video.onFirstFrame = { time in
      // The wall clock when the first frame was taken, not when it arrived.
      let wall = Date().addingTimeInterval(-(hostNow() - time).seconds)
      DispatchQueue.main.async { self.started(at: time, wall: wall, deniedPaths: deniedPaths) }
    }
    audio?.run()
    try await video.start(filter: filter, display: display)
  }

  private func started(at time: CMTime, wall: Date, deniedPaths: [String]) {
    start = time
    audio?.begin(at: time)
    timeline.write([
      "type": "start", "t": 0, "at": Session.iso(wall), "accessibility": accessibility,
      "microphone": audio != nil,
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
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      guard let self, let id = app?.bundleIdentifier, self.excludedApps.contains(id) else { return }
      self.filterPending = true
      self.video.hold()
      // Its first window can take a moment to be listed.
      for delay in [0.2, 1, 3] { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.refreshFilter() } }
    }
    timer = Timer.scheduledTimer(withTimeInterval: focusPollInterval, repeats: true) { [weak self] _ in self?.tick() }
    tick()
    if stopRequested { stop() }
  }

  /// Writes `stop`, then finishes video, audio and OCR, and exits.
  func stop() {
    stopRequested = true
    guard start != nil, !stopping else { return }
    stopping = true
    timer?.invalidate()
    focusFrame?.cancel()
    let end = hostNow()
    self.end = end
    stoppedAt = Date()
    timeline.write(["type": "stop", "t": seconds(t(end)), "at": Session.iso(Date())])

    let done = DispatchGroup()
    var videoError: Error?
    done.enter()
    video.finish(at: end) { error in
      videoError = error
      done.leave()
    }
    if let audio {
      done.enter()
      audio.finish { done.leave() }
    }
    if let watcher {
      done.enter()
      watcher.stop { done.leave() }
    }
    done.enter()
    DispatchQueue.global().async {
      _ = self.ocrJobs.wait(timeout: .now() + ocrStopWait)
      done.leave()
    }
    done.notify(queue: .main) {
      if let videoError { fail("video failed: \(videoError)") }
      exit(0)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fail("session did not finish") }
  }

  // MARK: Privacy filter

  /// The main display minus Kladd and the excluded apps, which have no windows in video or keyframes.
  func currentFilter() async throws -> (SCContentFilter, SCDisplay) {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let mainID = CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
    else { throw Failure(message: "no display to capture") }
    let excluded = content.applications.filter {
      $0.processID == excludePid || excludedApps.contains($0.bundleIdentifier)
    }
    filteredPids = Set(excluded.map(\.processID))
    return (SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []), display)
  }

  func runningExcludedPids() -> Set<pid_t> {
    Set(
      NSWorkspace.shared.runningApplications
        .filter { $0.processIdentifier == excludePid || excludedApps.contains($0.bundleIdentifier ?? "") }
        .map(\.processIdentifier))
  }

  func refreshFilter() {
    Task { @MainActor in
      guard !stopping, let (filter, display) = try? await currentFilter() else { return }
      self.filter = filter
      self.display = display
      let filtered = filteredPids
      video.update(filter) { self.accepted(filtered: filtered) }
    }
  }

  /// The stream uses a new filter: video and keyframes go on once it leaves out every excluded app.
  /// Checked now, not when the filter was built: another excluded app can have launched since.
  func accepted(filtered: Set<pid_t>) {
    guard filterPending, runningExcludedPids().isSubset(of: filtered) else { return }
    filterPending = false
    video.release()
  }

  /// The video keeps going: a stream that stops on its own is started again into the same file.
  func restartVideo() {
    guard !stopping else { return }
    Task { @MainActor in
      do {
        let (filter, display) = try await currentFilter()
        self.filter = filter
        self.display = display
        let filtered = filteredPids
        try await video.start(filter: filter, display: display)
        accepted(filtered: filtered)
      } catch {
        logError("cannot restart video: \(error)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.restartVideo() }
      }
    }
  }

  // MARK: Every second

  func clickCount() -> UInt32 {
    CGEventSource.counterForEventType(.combinedSessionState, eventType: .leftMouseDown)
      &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: .rightMouseDown)
  }

  func tick() {
    ticks += 1
    if runningExcludedPids() != filteredPids { refreshFilter() }
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
    guard let filter, let display else { return nil }
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
    guard !idle, !capturingFrame, !filterPending, t() - lastFrameT >= changeFrameGap else { return }
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
    if filterPending { return true }
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
    excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) },
    excludedApps: Set(stringList("--exclude-apps", in: args)))
  session = current

  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { current.stop() }
    source.resume()
    signalSources.append(source)
  }
  // Stdin closing means Kladd went away: finish every file rather than leave them cut off.
  Thread.detachNewThread {
    while readLine() != nil {}
    DispatchQueue.main.async { current.stop() }
  }

  do {
    // The folder is <dataDir>/recordings/<session>: Kladd's own writes are not the student's work.
    let dataDir = URL(fileURLWithPath: dir).standardized.deletingLastPathComponent().deletingLastPathComponent()
    try await current.begin(deniedPaths: stringList("--deny-paths", in: args) + [dataDir.path + "/"])
  } catch {
    fail(String(describing: error))
  }
}
