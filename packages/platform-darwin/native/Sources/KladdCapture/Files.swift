// Shared by `session` and `clip`: the clock, and the JSON lines and arguments they read and write.
// Not in main.swift: its globals are set by its top-level code, which `swift test` never runs.

import CoreMedia
import Foundation

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

func iso(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}
