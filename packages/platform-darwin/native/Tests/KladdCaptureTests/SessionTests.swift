// Runs the session's writers on synthetic input, without a display: `vp run @kladd/platform-darwin#test:native`.

import AVFoundation
import CoreMedia
import Foundation
import Testing

@testable import kladd_capture

func tempDir() throws -> URL {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kladd-test-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  // FSEvents reports /private/var, not /var.
  return URL(fileURLWithPath: String(cString: realpath(dir.path, nil)))
}

/// A gray 4:2:0 frame like ScreenCaptureKit's, stamped `time`.
func frame(at time: CMTime) -> CMSampleBuffer {
  var pixels: CVPixelBuffer?
  CVPixelBufferCreate(nil, 320, 240, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, nil, &pixels)
  CVPixelBufferLockBaseAddress(pixels!, [])
  for plane in 0..<CVPixelBufferGetPlaneCount(pixels!) {
    memset(
      CVPixelBufferGetBaseAddressOfPlane(pixels!, plane), 128,
      CVPixelBufferGetBytesPerRowOfPlane(pixels!, plane) * CVPixelBufferGetHeightOfPlane(pixels!, plane))
  }
  CVPixelBufferUnlockBaseAddress(pixels!, [])
  var format: CMVideoFormatDescription?
  CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: pixels!, formatDescriptionOut: &format)
  var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: time, decodeTimeStamp: .invalid)
  var sample: CMSampleBuffer?
  CMSampleBufferCreateReadyWithImageBuffer(
    allocator: nil, imageBuffer: pixels!, formatDescription: format!, sampleTiming: &timing, sampleBufferOut: &sample)
  return sample!
}

/// The presentation times of the video samples in `url`, in seconds from the first frame.
func sampleTimes(_ url: URL) async throws -> [Double] {
  let asset = AVURLAsset(url: url)
  let track = try #require(try await asset.loadTracks(withMediaType: .video).first)
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  reader.add(output)
  reader.startReading()
  var times: [Double] = []
  while let sample = output.copyNextSampleBuffer() {
    if CMSampleBufferGetNumSamples(sample) > 0 { times.append(sample.presentationTimeStamp.seconds) }
  }
  // The reader gives decode order, and the file starts a little after 0.
  try #require(!times.isEmpty, "no video frames in \(url.path)")
  let sorted = times.sorted()
  return sorted.map { $0 - sorted[0] }
}

/// Paced like the stream: an input that expects real-time data refuses frames sent faster.
func append(_ video: SessionVideo, at time: CMTime) async throws {
  video.append(frame(at: time))
  try await Task.sleep(for: .milliseconds(30))
}

func finish(_ video: SessionVideo, at end: CMTime) async throws {
  let error: Error? = await withCheckedContinuation { done in video.finish(at: end) { done.resume(returning: $0) } }
  if let error { throw error }
}

let step = CMTime(value: 1, timescale: videoFps)

@Test func everyFrameReachesTheVideo() async throws {
  let url = try tempDir().appendingPathComponent("screen.mp4")
  let video = SessionVideo(url: url)
  let start = hostNow()
  for index in 0..<6 { try await append(video, at: start + CMTimeMultiply(step, multiplier: Int32(index))) }
  try await finish(video, at: start + CMTime(seconds: 2, preferredTimescale: 600))
  let times = try await sampleTimes(url)
  // Six frames, then the last one again at stop.
  #expect(times.count == 7)
  #expect(abs(times.last! - 2) < 0.01)
}

@Test func heldFramesAreLeftOut() async throws {
  let url = try tempDir().appendingPathComponent("screen.mp4")
  let video = SessionVideo(url: url)
  let start = hostNow()
  try await append(video, at: start)
  video.hold()
  try await append(video, at: hostNow())
  // Taken before the release: may still show the excluded app.
  let beforeRelease = hostNow()
  video.release()
  try await append(video, at: beforeRelease)
  let later = hostNow()
  try await append(video, at: later)
  try await finish(video, at: hostNow())
  let times = try await sampleTimes(url)
  #expect(times.count == 3)
  #expect(abs(times[1] - (later - start).seconds) < 0.01)
}

@Test func stopReportsChangesNotYetDelivered() async throws {
  let dir = try tempDir()
  let seen = try await MainActor.run {
    var seen: [String] = []
    let watcher = FileWatcher(root: dir.path, denied: []) { seen.append($0) }
    return (watcher, { seen })
  }
  try await Task.sleep(for: .milliseconds(300))
  let first = dir.appendingPathComponent("first.txt")
  let second = dir.appendingPathComponent("second.txt")
  try Data("a".utf8).write(to: first)
  try await Task.sleep(for: .milliseconds(200))
  try Data("b".utf8).write(to: second)
  await withCheckedContinuation { stopped in DispatchQueue.main.async { seen.0.stop { stopped.resume() } } }
  let paths = await MainActor.run { seen.1() }
  #expect(paths.contains(first.path) && paths.contains(second.path))
}
