// One clip (klipp), recorded by the running `session` on `clip-start` until `clip-stop`
// (Session.swift): the main display as screen.mp4, the microphone as audio.m4a, and the student's
// ink as marks.jsonl (Ink.swift). File names and line shapes are the contract in
// packages/domain/src/SessionFolder.ts; docs/internals/session-capture.md has the why.
//
// One clock: `t` is seconds since the first video frame, read from the host clock that
// ScreenCaptureKit stamps frames with, so `t` is also the video's (and the audio's) timestamp.
// Only the video must work; sound and ink log to stderr when they fail and the clip goes on. A clip
// that fails never stops the session.

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
/// A clip with no video frame this long after its start has failed: ScreenCaptureKit kept refusing
/// or hanging its streams (another process capturing the screen does that), and the caller waits.
let clipFirstFrameWait: Double = 10
/// A clip whose files have not finished this long after its stop has failed.
let clipFinishWait: Double = 30

// MARK: - Video

/// screen.mp4: ScreenCaptureKit frames written by AVAssetWriter, fragmented so a crash keeps it.
final class ClipVideo: NSObject, SCStreamDelegate, SCStreamOutput {
  private let url: URL
  private let queue = DispatchQueue(label: "kladd.clip.video")
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private var lastTime = CMTime.invalid
  /// The first frame's time: t = 0.
  private var firstTime = CMTime.invalid
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
  /// Called on the main queue when screen.mp4 can't be written.
  var onFailed: (String) -> Void = { _ in }

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
    guard let writer, let input else { return }
    // The writer can fail on its own, between appends: the clip ends then, and the session goes on.
    let failed = {
      self.finished = true
      let reason = "video failed at \((time - self.firstTime).seconds) s: \(String(describing: writer.error))"
      DispatchQueue.main.async { self.onFailed(reason) }
    }
    guard writer.status == .writing else { return failed() }
    // An invalid CMTime compares greater than every valid one, so the first frame needs its own case.
    guard input.isReadyForMoreMediaData, !lastTime.isValid || time > lastTime else { return }
    guard input.append(sampleBuffer) else { return failed() }
    lastTime = time
    lastFrame = sampleBuffer
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
            // B-frames in a fragmented file failed the writer (-16341) right after its first fragment.
            AVVideoAllowFrameReorderingKey: false,
          ],
        ])
      input.expectsMediaDataInRealTime = true
      writer.add(input)
      guard writer.startWriting() else { throw writer.error ?? Failure(message: "cannot start video") }
      writer.startSession(atSourceTime: time)
      firstTime = time
      self.writer = writer
      self.input = input
      return true
    } catch {
      finished = true
      DispatchQueue.main.async { self.onFailed("cannot write video: \(error)") }
      return false
    }
  }

  /// Ends the file at `end` with the last frame again, so the video lasts until the recording
  /// stopped (endSession alone does not make players show it that long).
  func finish(at end: CMTime, done: @escaping (Error?) -> Void) {
    queue.async {
      self.current?.stopCapture { _ in }
      self.finished = true
      guard let writer = self.writer, writer.status == .writing else { return done(self.writer?.error) }
      // The encoder can still be busy with the frame before: wait for it, briefly.
      let deadline = Date().addingTimeInterval(1)
      while let input = self.input, !input.isReadyForMoreMediaData, writer.status == .writing, Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
      }
      if let input = self.input, let last = self.lastFrame, end > self.lastTime, writer.status == .writing,
        input.isReadyForMoreMediaData
      {
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: end, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
          allocator: nil, sampleBuffer: last, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
          sampleBufferOut: &copy)
        if let copy, input.append(copy) { self.lastTime = end }
      }
      self.lastFrame = nil
      self.input?.markAsFinished()
      // Ending at an invalid time (no frame was written) raises and aborts the helper. The last
      // frame is shown for one frame's time: a session that ends at it leaves it out.
      if self.lastTime.isValid { writer.endSession(atSourceTime: self.lastTime + CMTime(value: 1, timescale: videoFps)) }
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

/// audio.m4a, written from samples on the microphone's clock, from `zero` (t = 0 on that clock).
/// A microphone that starts late is padded with silence: players ignore the empty edit
/// AVAssetWriter would put there instead, which would shift speech against `t`. Appending to an
/// input that is not ready raises and kills the helper, so samples, and the silence before them,
/// wait in `backlog` until it is. Not thread-safe: the audio queue only.
final class AudioWriter {
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let format: CMFormatDescription
  /// Written up to here: the silence before a sample is what lies between this and its time.
  private var written: CMTime
  private var backlog: [CMSampleBuffer] = []
  /// The writer gave up; nothing more is written.
  private(set) var failed = false

  init(url: URL, zero: CMTime, format: CMFormatDescription) throws {
    writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    writer.movieFragmentInterval = fragmentInterval
    let rate = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee.mSampleRate ?? 48_000
    input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 1, AVSampleRateKey: rate,
        AVEncoderBitRateKey: audioBitrate,
      ],
      sourceFormatHint: format)
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? Failure(message: "cannot start audio") }
    writer.startSession(atSourceTime: zero)
    self.format = format
    written = zero
  }

  func append(_ sample: CMSampleBuffer) {
    guard !failed else { return }
    backlog.append(sample)
    drain()
  }

  /// Appends silence and samples while the input takes them.
  private func drain() {
    while let next = backlog.first, !failed {
      guard writer.status == .writing else { return giveUp() }
      guard input.isReadyForMoreMediaData else { return }
      let gap = next.presentationTimeStamp - written
      if gap.seconds > 0.01, let pad = silence(from: written, duration: gap) {
        guard input.append(pad) else { return giveUp() }
        written = written + pad.duration
        continue
      }
      backlog.removeFirst()
      guard input.append(next) else { return giveUp() }
      written = CMTimeMaximum(written, next.presentationTimeStamp + next.duration)
    }
  }

  private func giveUp() {
    failed = true
    backlog = []
    logError("audio failed: \(String(describing: writer.error))")
  }

  /// At most a second of silence: the encoder takes it at once, and real samples follow soon.
  private func silence(from time: CMTime, duration: CMTime) -> CMSampleBuffer? {
    let pcm = AVAudioFormat(cmAudioFormatDescription: format)
    let frames = AVAudioFrameCount(min(duration.seconds, 1) * pcm.sampleRate)
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: frames) else { return nil }
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

  /// Writes what is still waiting, for up to `wait` seconds, then finishes the file. Blocks.
  func finish(wait: Double = 2, done: @escaping () -> Void) {
    let deadline = Date().addingTimeInterval(wait)
    drain()
    while !backlog.isEmpty, !failed, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.01)
      drain()
    }
    if !backlog.isEmpty { logError("audio: \(backlog.count) samples left out at stop") }
    guard writer.status == .writing else { return done() }
    input.markAsFinished()
    writer.finishWriting {
      if self.writer.status != .completed { logError("audio failed: \(String(describing: self.writer.error))") }
      done()
    }
  }
}

/// The default microphone into an AudioWriter, from t = 0 converted to the microphone's clock.
final class ClipAudio: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private let url: URL
  private let capture = AVCaptureSession()
  private let queue = DispatchQueue(label: "kladd.clip.audio")
  private var writer: AudioWriter?
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
      do {
        writer = try AudioWriter(url: url, zero: zero, format: format)
      } catch {
        logError("cannot write audio: \(error)")
        finished = true
        return
      }
    }
    writer?.append(sampleBuffer)
  }

  func finish(done: @escaping () -> Void) {
    capture.stopRunning()
    queue.async {
      self.finished = true
      guard let writer = self.writer else { return done() }
      writer.finish(done: done)
    }
  }
}

// MARK: - Clip

/// Runs on the main queue, apart from the video and audio callbacks. Records through the session's
/// privacy filter, and calls `ended` once, with nil when its files are done.
@MainActor final class Clip {
  let privacy: PrivacyFilter
  let video: ClipVideo
  let audioURL: URL
  var audio: ClipAudio?
  let marks: LineWriter
  var ink: InkOverlay!
  let recording: () -> Void
  let ended: (String?) -> Void

  var start: CMTime?
  /// Counts video starts: a pending one that is no longer the latest does nothing.
  var videoAttempt = 0
  var stopping = false
  var done = false

  init(dir: URL, privacy: PrivacyFilter, recording: @escaping () -> Void, ended: @escaping (String?) -> Void) {
    self.privacy = privacy
    self.recording = recording
    self.ended = ended
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

  /// Starts on the session's filter and display; without them (the Mac is locked), or with no frame
  /// by `clipFirstFrameWait`, it fails.
  func begin() {
    guard let filter = privacy.filter, let display = privacy.display else {
      return end("no display to capture")
    }
    privacy.video = video
    video.onStreamStopped = { [weak self] in self?.restartVideo(after: videoRestartDelay) }
    video.onFirstFrame = { [weak self] time in DispatchQueue.main.async { self?.started(at: time) } }
    video.onFailed = { [weak self] reason in self?.stop(failure: reason) }
    audio?.run()
    watchVideo(videoAttempt)
    DispatchQueue.main.asyncAfter(deadline: .now() + clipFirstFrameWait) { [weak self] in
      guard let self, self.start == nil, !self.stopping else { return }
      self.stop(failure: "no video frame in \(Int(clipFirstFrameWait)) s")
    }
    Task {
      do {
        try await startVideo(filter: filter, display: display)
      } catch {
        logError("cannot start video: \(error)")
        restartVideo(after: videoRetryDelay)
      }
    }
  }

  private func started(at time: CMTime) {
    guard !stopping else { return }
    start = time
    audio?.begin(at: time)
    ink.start()
    recording()
  }

  func microphoneGranted() {
    guard !stopping, audio == nil, let audio = ClipAudio(url: audioURL) else { return }
    self.audio = audio
    audio.run()
    if let start { audio.begin(at: start) }
  }

  /// Finishes the ink, video and audio, then calls `ended`. A stop before the first frame ends
  /// the clip without a video, as failed.
  func stop(failure: String? = nil) {
    guard !stopping else { return }
    stopping = true
    if privacy.video === video { privacy.video = nil }
    let end = hostNow()
    ink.stop()
    let failure = failure ?? (start == nil ? "stopped before the first video frame" : nil)

    let group = DispatchGroup()
    var videoError: Error?
    group.enter()
    video.finish(at: end) { error in
      videoError = error
      group.leave()
    }
    if let audio {
      group.enter()
      audio.finish { group.leave() }
    }
    group.notify(queue: .main) {
      self.end(failure ?? videoError.map { "video failed: \($0)" })
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + clipFinishWait) { self.end("clip did not finish") }
  }

  private func end(_ failure: String?) {
    guard !done else { return }
    done = true
    stopping = true
    if privacy.video === video { privacy.video = nil }
    ended(failure)
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
          // Built again: the stream may have stopped because the display changed.
          let (filter, display) = try await self.privacy.load()
          guard attempt == self.videoAttempt, !self.stopping else { return }
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
