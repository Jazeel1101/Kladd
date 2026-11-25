// kladd-transcribe: speech to text with WhisperKit, like Hex. TranscriberDarwin (../../src) runs it.
// It is separate from kladd-capture so WhisperKit can't slow down or break recording:
// docs/internals/transcription.md.
//
//   kladd-transcribe prepare --model-dir <dir>      downloads Whisper if missing, prints "ready"
//   kladd-transcribe transcribe --model-dir <dir> --audio <file> --out <file.jsonl>
//       writes TranscriptSegment lines, prints the detected language, such as "no".
//
// Exit codes: 0 done, 64 bad usage, 1 anything else (the reason is on stderr).

import Foundation
import WhisperKit

func say(_ line: String) {
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data(("kladd-transcribe: " + message + "\n").utf8))
  exit(code)
}

func option(_ name: String, in args: [String]) -> String? {
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}

/// Whisper large-v3-turbo in argmaxinc/whisperkit-coreml on Hugging Face, the variant Hex offers.
let whisperVariant = "openai_whisper-large-v3-v20240930_turbo_632MB"

func modelFolder(_ modelDir: URL) -> URL { modelDir.appending(path: whisperVariant, directoryHint: .isDirectory) }

/// Written last by `prepare`: without it the model is not complete.
func readyMarker(_ modelDir: URL) -> URL { modelFolder(modelDir).appending(path: ".ready") }

func loadWhisper(_ folder: URL) async throws -> WhisperKit {
  try await WhisperKit(
    WhisperKitConfig(
      modelFolder: folder.path,
      tokenizerFolder: folder.appending(path: "tokenizer", directoryHint: .isDirectory),
      verbose: false, logLevel: .none, prewarm: false, load: true, download: false))
}

/// Downloads the model into `<model-dir>/.download`, where an interrupted download resumes, and moves
/// it into place. Then loads it there once, which fetches the tokenizer and compiles the model for
/// this Mac (minutes; CoreML caches it by path, so it can't be done before the move), and marks it
/// ready. Prints "ready".
func runPrepare(_ args: [String]) async {
  guard let dir = option("--model-dir", in: args) else {
    fail("usage: kladd-transcribe prepare --model-dir <dir>", code: 64)
  }
  let modelDir = URL(filePath: dir, directoryHint: .isDirectory)
  let target = modelFolder(modelDir)
  let files = FileManager.default
  if files.fileExists(atPath: readyMarker(modelDir).path) {
    say("ready")
    exit(0)
  }
  if !files.fileExists(atPath: target.path) {
    let staging = modelDir.appending(path: ".download", directoryHint: .isDirectory)
    do {
      let downloaded = try await WhisperKit.download(variant: whisperVariant, downloadBase: staging)
      try files.moveItem(at: downloaded, to: target)
      try? files.removeItem(at: staging)
    } catch {
      fail("download failed: \(error.localizedDescription)")
    }
  }
  do {
    _ = try await loadWhisper(target)
    try Data().write(to: readyMarker(modelDir))
  } catch {
    // The files are there but don't load: download them again next time.
    try? files.removeItem(at: target)
    fail("model does not load: \(error.localizedDescription)")
  }
  say("ready")
  exit(0)
}

struct TranscriptLine: Encodable {
  let t: Double
  let end: Double
  let text: String
}

/// Writes one TranscriptSegment per line to `--out` and prints the detected language, such as "no".
func runTranscribe(_ args: [String]) async {
  guard let dir = option("--model-dir", in: args), let audio = option("--audio", in: args),
    let out = option("--out", in: args)
  else {
    fail("usage: kladd-transcribe transcribe --model-dir <dir> --audio <file> --out <file.jsonl>", code: 64)
  }
  let modelDir = URL(filePath: dir, directoryHint: .isDirectory)
  guard FileManager.default.fileExists(atPath: readyMarker(modelDir).path) else { fail("model not downloaded yet") }
  do {
    let whisper = try await loadWhisper(modelFolder(modelDir))
    let results = try await whisper.transcribe(
      audioPath: audio,
      decodeOptions: DecodingOptions(
        task: .transcribe, language: nil, detectLanguage: true, skipSpecialTokens: true))
    let seconds = { (value: Float) in (Double(value) * 100).rounded() / 100 }
    let encoder = JSONEncoder()
    var jsonl = Data()
    for segment in results.flatMap(\.segments) {
      let text = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if text.isEmpty { continue }
      jsonl.append(try encoder.encode(TranscriptLine(t: seconds(segment.start), end: seconds(segment.end), text: text)))
      jsonl.append(Data("\n".utf8))
    }
    try jsonl.write(to: URL(filePath: out), options: .atomic)
    say(results.first?.language ?? "")
    exit(0)
  } catch {
    fail("transcription failed: \(error.localizedDescription)")
  }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "prepare": await runPrepare(args)
case "transcribe": await runTranscribe(args)
default: fail("usage: kladd-transcribe prepare --model-dir <dir> | transcribe --model-dir <dir> --audio <file> --out <file>", code: 64)
}
