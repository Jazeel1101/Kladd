// `kladd-capture clip`: records one clip (klipp) into its folder until SIGINT, SIGTERM or stdin
// closing: the main display as screen.mp4, the microphone as audio.m4a, and the student's ink as
// marks.jsonl (Ink.swift). File names and line shapes are the contract in
// packages/domain/src/SessionFolder.ts; docs/internals/session-capture.md has the why.
//
// One clock: `t` is seconds since the first video frame, read from the host clock that
// ScreenCaptureKit stamps frames with, so `t` is also the video's (and the audio's) timestamp.
// Only the video must work; sound and ink log to stderr when they fail and the clip goes on.

import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

/// Video for a student to watch and an agent to read frames from: fits 1920x1200, about the
/// display's own size in points, so text is as sharp as on screen and the frames fit an LLM's
/// image size without scaling down. 30 fps keeps ink and the pointer smooth; a still screen sends
/// no frames, so it costs little.
let videoMaxSize = CGSize(width: 1920, height: 1200)
let videoFps: Int32 = 30
let videoBitrate = 4_000_000
/// A keyframe every 2 s, so a frame at any `t` decodes quickly.
let videoKeyFrameInterval = 2
let audioBitrate = 64_000
/// Fragments make screen.mp4 and audio.m4a playable after a crash, up to the last fragment.
let fragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
/// A stream that stops on its own is started again after this: at once, ScreenCaptureKit's next
/// call can hang (seen when another Kladd helper interrupted the stream).
let videoRestartDelay: Double = 1
/// After a failed start, the next try waits this long.
let videoRetryDelay: Double = 5
/// A started stream sends a frame at once, even of a still screen. One that sent none by now is
/// dropped and started again: ScreenCaptureKit can leave a start hanging without an error.
let videoStartTimeout: Double = 3
/// A stop before the first frame waits this long for it, then exits without a video.
let firstFrameWait: Double = 10

// MARK: - Video

/// screen.mp4: ScreenCaptureKit frames written by AVAssetWriter, fragmented so a crash keeps it.
final class ClipVideo: NSObject, SCStreamDelegate, SCStreamOutput {
  private let url: URL
  private let queue = DispatchQueue(label: "kladd.clip.video")
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var lastTime = CMTime.invalid
  /// Frames taken before this host time are not written: infinite from when an excluded app
  /// launches until the stream has accepted a filter without it.
  private var writeFrom = CMTime.zero
  /// Shown again at stop: ScreenCaptureKit sends no frames while the screen is still.
  private var lastFrame: CMSampleBuffer?
  private var finished = false
  /// The stream frames are written from. Frames and errors from one it replaced are ignored.
  /// Video queue.
  private var current: SCStream?
  private var currentSentFrame = false
  /// Called once, on the video queue, with the host time of the first frame: t = 0.
  var onFirstFrame: (CMTime) -> Void = { _ in }
  /// Called on the main queue when the stream stops on its own (display gone, capture error).
  var onStreamStopped: () -> Void = {}

  init(url: URL) { self.url = url }

  /// Replaces the current stream with a new one through `filter`.
  @MainActor func start(filter: SCContentFilter, display: SCDisplay) async throws {
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
    use(stream)
    try await stream.startCapture()
  }

  private func use(_ stream: SCStream) {
    let replaced = queue.sync {
      defer {
        current = stream
        currentSentFrame = false
      }
      return current
    }
    replaced?.stopCapture { _ in }
  }

  /// Whether the current stream has sent a frame yet.
  var sentFrame: Bool { queue.sync { currentSentFrame } }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, stream === current else { return }
    currentSentFrame = true
    guard !finished, sampleBuffer.isValid,
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
            AVVideoMaxKeyFrameIntervalDurationKey: videoKeyFrameInterval,
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
    queue.async {
      self.current?.stopCapture { _ in }
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
    queue.sync { current }?.updateContentFilter(filter) { error in
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
    guard queue.sync(execute: { stream === current }) else { return }
    logError("video stopped: \(error)")
    DispatchQueue.main.async { self.onStreamStopped() }
  }
}

// MARK: - Audio

/// audio.m4a from the default microphone, starting at t = 0 (converted to the microphone's clock).
/// A microphone that starts late is padded with silence: players ignore the empty edit
/// AVAssetWriter would put there instead, which would shift speech against `t`.
final class ClipAudio: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private let url: URL
  private let capture = AVCaptureSession()
  private let queue = DispatchQueue(label: "kladd.clip.audio")
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
      // In pieces of at most a minute: a microphone granted during the clip starts minutes late.
      var padded = zero
      while let input, (sampleBuffer.presentationTimeStamp - padded).seconds > 0.01,
        let pad = silence(from: padded, duration: sampleBuffer.presentationTimeStamp - padded, format: format),
        input.append(pad)
      {
        padded = padded + pad.duration
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

// MARK: - Clip

/// Runs on the main queue, apart from the video and audio callbacks.
@MainActor final class Clip {
  let privacy: PrivacyFilter
  let video: ClipVideo
  let audioURL: URL
  var audio: ClipAudio?
  let marks: LineWriter
  var ink: InkOverlay!
  var timer: Timer?

  var start: CMTime?
  /// Counts video starts: a pending one that is no longer the latest does nothing.
  var videoAttempt = 0
  var stopRequested = false
  var stopping = false

  init(dir: URL, privacy: PrivacyFilter) {
    self.privacy = privacy
    video = ClipVideo(url: dir.appendingPathComponent("screen.mp4"))
    audioURL = dir.appendingPathComponent("audio.m4a")
    marks = LineWriter(dir.appendingPathComponent("marks.jsonl"))
    ink = InkOverlay(clock: { [unowned self] in self.t() }) { [marks] stroke in marks.write(stroke.mark) }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
      audio = ClipAudio(url: audioURL)
    case .notDetermined:
      // The clip doesn't wait for the answer: sound starts when it comes, padded from t = 0.
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        guard granted else { return }
        DispatchQueue.main.async { self.microphoneGranted() }
      }
    default:
      break
    }
  }

  func t(_ time: CMTime = hostNow()) -> Double {
    guard let start else { return 0 }
    return (time - start).seconds
  }

  func begin() async throws {
    let (filter, display) = try await privacy.load()
    privacy.apply = { [video] filter, accepted in video.update(filter, accepted: accepted) }
    privacy.onPending = { [video] in video.hold() }
    privacy.onClear = { [video] in video.release() }
    privacy.watchLaunches()
    video.onStreamStopped = { [weak self] in self?.restartVideo(after: videoRestartDelay) }
    video.onFirstFrame = { time in DispatchQueue.main.async { self.started(at: time) } }
    audio?.run()
    watchVideo(videoAttempt)
    do {
      try await startVideo(filter: filter, display: display)
    } catch {
      logError("cannot start video: \(error)")
      restartVideo(after: videoRetryDelay)
    }
  }

  private func started(at time: CMTime) {
    start = time
    audio?.begin(at: time)
    ink.start()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.privacy.check() }
    }
    say("recording")
    if stopRequested { stop() }
  }

  func microphoneGranted() {
    guard !stopping, audio == nil, let audio = ClipAudio(url: audioURL) else { return }
    self.audio = audio
    audio.run()
    if let start { audio.begin(at: start) }
  }

  /// Finishes the ink, video and audio, and exits. Before the first frame it waits for it, so the
  /// video is valid, but not forever: the stream may never work.
  func stop() {
    guard start != nil else {
      if !stopRequested {
        DispatchQueue.main.asyncAfter(deadline: .now() + firstFrameWait) {
          if self.start == nil { fail("stopped before the first video frame") }
        }
      }
      stopRequested = true
      return
    }
    stopRequested = true
    guard !stopping else { return }
    stopping = true
    privacy.stopped = true
    timer?.invalidate()
    let end = hostNow()
    ink.stop()

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
    done.notify(queue: .main) {
      if let videoError { fail("video failed: \(videoError)") }
      exit(0)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fail("clip did not finish") }
  }

  /// The video keeps going: a stream that stops on its own is started again into the same file.
  func restartVideo(after delay: Double) {
    guard !stopping else { return }
    videoAttempt += 1
    let attempt = videoAttempt
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
      guard attempt == self.videoAttempt, !self.stopping else { return }
      self.watchVideo(attempt)
      Task {
        do {
          let (filter, display) = try await self.privacy.load()
          guard attempt == self.videoAttempt else { return }
          try await self.startVideo(filter: filter, display: display)
        } catch {
          guard attempt == self.videoAttempt else { return }
          logError("cannot restart video: \(error)")
          self.restartVideo(after: videoRetryDelay)
        }
      }
    }
  }

  private func startVideo(filter: SCContentFilter, display: SCDisplay) async throws {
    let filtered = privacy.filteredPids
    try await video.start(filter: filter, display: display)
    privacy.accepted(filtered: filtered)
  }

  /// ScreenCaptureKit can leave a call hanging without an error: an attempt with no frame by
  /// `videoStartTimeout` is given up for a new one.
  private func watchVideo(_ attempt: Int) {
    DispatchQueue.main.asyncAfter(deadline: .now() + videoStartTimeout) {
      guard attempt == self.videoAttempt, !self.stopping, !self.video.sentFrame else { return }
      logError("video sent no frame; starting it again")
      self.restartVideo(after: 0)
    }
  }
}

var clip: Clip?

@MainActor func runClip(_ args: [String]) async {
  guard let dir = option("--dir", in: args) else { fail("clip needs --dir <folder>", code: exitUsage) }
  requireGranted()
  let current = Clip(
    dir: URL(fileURLWithPath: dir),
    privacy: PrivacyFilter(
      excludePid: option("--exclude-pid", in: args).flatMap { pid_t($0) },
      excludedApps: Set(stringList("--exclude-apps", in: args))))
  clip = current
  stopOn { current.stop() }
  do {
    try await current.begin()
  } catch {
    fail(String(describing: error))
  }
}
