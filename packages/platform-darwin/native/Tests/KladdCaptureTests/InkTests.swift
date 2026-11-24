// The ink's input and marks.jsonl, without a display or an overlay.

import CoreGraphics
import Foundation
import Testing

@testable import kladd_capture

/// Polls `input` once per point, 10 ms apart from `from`.
func draw(_ input: inout InkInput, _ points: [CGPoint], from: Double = 1, otherModifiers: Bool = false) {
  for (index, point) in points.enumerated() {
    let finished = input.poll(shift: true, otherModifiers: otherModifiers, point: point, at: from + Double(index) / 100)
    #expect(finished == nil)
  }
}

let line = (0...10).map { CGPoint(x: 100 + Double($0) * 3, y: 200) }

@Test func aStrokeBecomesAMarkLine() throws {
  var input = InkInput()
  draw(&input, line + [CGPoint(x: 130.4, y: 200.2)])
  let finished = input.poll(shift: false, otherModifiers: false, point: CGPoint(x: 131, y: 200), at: 2)
  let stroke = try #require(finished)
  let url = try tempDir().appendingPathComponent("marks.jsonl")
  LineWriter(url).write(stroke.mark)
  let text = try String(contentsOf: url, encoding: .utf8)
  // The last point is too close to keep; ⇧ let go at 2 s doesn't move `end`.
  #expect(text == #"{"end":1.1,"points":[[100,200],[103,200],[106,200],[109,200],[112,200],[115,200],[118,200],[121,200],[124,200],[127,200],[130,200]],"t":1}"# + "\n")
}

@Test func typingACapitalIsNoStroke() {
  var input = InkInput()
  draw(&input, [CGPoint(x: 50, y: 50), CGPoint(x: 52, y: 51), CGPoint(x: 53, y: 50)])
  let finished = input.poll(shift: false, otherModifiers: false, point: CGPoint(x: 53, y: 50), at: 2)
  #expect(finished == nil)
}

@Test func aChordWithShiftDrawsNothingUntilShiftIsLetGo() {
  var input = InkInput()
  // ⌥⇧C, then ⌥ is let go before ⇧.
  draw(&input, [CGPoint(x: 0, y: 0)], otherModifiers: true)
  draw(&input, line)
  #expect(input.live == nil)
  let none = input.poll(shift: false, otherModifiers: false, point: nil, at: 3)
  #expect(none == nil)
  draw(&input, line, from: 4)
  let stroke = input.finish()
  #expect(stroke?.t == 4)
}

@Test func leavingTheDisplayEndsTheStroke() {
  var input = InkInput()
  draw(&input, line)
  let finished = input.poll(shift: true, otherModifiers: false, point: nil, at: 2)
  #expect(finished?.points.count == line.count)
}

@Test func inkHoldsThenFades() {
  #expect(inkOpacity(age: 0) == 1)
  #expect(inkOpacity(age: inkHold) == 1)
  #expect(abs(inkOpacity(age: inkHold + inkFade / 2)! - 0.25) < 1e-9)
  #expect(inkOpacity(age: inkHold + inkFade) == nil)
}

extension InkStroke: Equatable {
  public static func == (a: InkStroke, b: InkStroke) -> Bool { a.t == b.t && a.end == b.end && a.points == b.points }
}
