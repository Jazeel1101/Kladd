import AVFoundation
import CoreGraphics

/// `frame --video <file.mp4> --at <seconds> --out <file.jpg>`: the video's frame at that time, as
/// a JPEG, for the summary agent's `frame_at`. Makes the output's folder. Needs no permission.
func runFrame(_ args: [String]) async {
  guard let video = option("--video", in: args), let out = option("--out", in: args),
    let at = option("--at", in: args).flatMap(Double.init), at >= 0
  else { fail("usage: kladd-capture frame --video <file.mp4> --at <seconds> --out <file.jpg>", code: exitUsage) }
  let asset = AVURLAsset(url: URL(fileURLWithPath: video))
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  // Clips have a keyframe every 2 s; a tenth of a second either way decodes fast and is what `t` means.
  let tolerance = CMTime(seconds: 0.1, preferredTimescale: 600)
  generator.requestedTimeToleranceBefore = tolerance
  generator.requestedTimeToleranceAfter = tolerance
  do {
    let duration = try await asset.load(.duration).seconds
    if at > duration { fail("t=\(at) is past the video's end at \(duration)") }
    let (image, _) = try await generator.image(at: CMTime(seconds: at, preferredTimescale: 600))
    let url = URL(fileURLWithPath: out)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !writeJPEG(image, to: url) { fail("could not write \(out)") }
    exit(0)
  } catch {
    fail("no frame at \(at): \(error.localizedDescription)")
  }
}
