// Ink during a clip, like Scrawl's (github.com/kitlangton/scrawl, MIT): hold ⇧ alone and move the
// pointer to draw a red stroke, which fades out shortly after ⇧ is let go. The overlay ignores the
// mouse, so clicks and scrolls reach the app underneath, and never takes focus. Input is polled
// modifier flags and the pointer position, which need no permission (Input Monitoring is only for
// reading keys). The helper's windows are not left out of the video, so the ink is recorded.

import AppKit
import QuartzCore

/// #ff3b30.
let inkColor = CGColor(srgbRed: 1, green: 0x3b / 255, blue: 0x30 / 255, alpha: 1)
let inkWidth: CGFloat = 4
let inkPollInterval: TimeInterval = 1.0 / 120
/// A point closer than this to the last one is not kept.
let inkMinStep: CGFloat = 1.5
/// A ⇧ press whose pointer moves less than this from where it began is typing, not ink.
let inkMinSpan: CGFloat = 6
/// After ⇧ is let go, a stroke stays this long, then fades out over `inkFade`.
let inkHold: Double = 0.65
let inkFade: Double = 0.65

/// A stroke's opacity `age` seconds after ⇧ was let go; nil once it is gone.
func inkOpacity(age: Double) -> Double? {
  if age >= inkHold + inkFade { return nil }
  if age <= inkHold { return 1 }
  let faded = (age - inkHold) / inkFade
  return (1 - faded) * (1 - faded)
}

/// One stroke, in points from the main display's top-left corner, `t` and `end` in clip seconds.
struct InkStroke {
  var t: Double
  var end: Double
  var points: [CGPoint] = []

  /// Reaches `inkMinSpan` from where it began.
  var isInk: Bool {
    guard let first = points.first else { return false }
    return points.contains { hypot($0.x - first.x, $0.y - first.y) >= inkMinSpan }
  }

  mutating func add(_ point: CGPoint, at time: Double) {
    if let last = points.last, hypot(point.x - last.x, point.y - last.y) < inkMinStep { return }
    points.append(point)
    end = time
  }

  /// A line of marks.jsonl (Mark in SessionFolder.ts).
  var mark: [String: Any] {
    ["t": seconds(t), "end": seconds(end), "points": points.map { [Int($0.x.rounded()), Int($0.y.rounded())] }]
  }
}

/// Polled ⇧ and pointer to strokes. ⇧ alone draws; ⇧ with ⌘, ⌃ or ⌥ (⌥⇧C stops the clip) never
/// does until ⇧ is let go, so letting go of ⌥ first doesn't start a stroke.
struct InkInput {
  private(set) var live: InkStroke?
  private var chord = false

  /// One poll; `point` is nil off the main display. Returns a stroke that just finished.
  mutating func poll(shift: Bool, otherModifiers: Bool, point: CGPoint?, at time: Double) -> InkStroke? {
    if !shift { chord = false } else if otherModifiers { chord = true }
    guard shift, !chord, let point else { return finish() }
    if live == nil { live = InkStroke(t: time, end: time) }
    live?.add(point, at: time)
    return nil
  }

  /// Ends the live stroke; returns it if it is ink.
  mutating func finish() -> InkStroke? {
    defer { live = nil }
    return live?.isInk == true ? live : nil
  }
}

/// A smooth path through `points`, in a layer `height` points tall (layers count y from the bottom).
func inkPath(_ points: [CGPoint], height: CGFloat) -> CGPath {
  let path = CGMutablePath()
  let flipped = points.map { CGPoint(x: $0.x, y: height - $0.y) }
  guard let first = flipped.first else { return path }
  path.move(to: first)
  // Through the midpoints, with each point as the control: no corners where the pointer was sampled.
  for (a, b) in zip(flipped, flipped.dropFirst()) {
    path.addQuadCurve(to: CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2), control: a)
  }
  path.addLine(to: flipped.last!)
  return path
}

/// The click-through panel over the main display, and the poll that draws on it. Main queue only.
@MainActor final class InkOverlay {
  private let clock: () -> Double
  private let finished: (InkStroke) -> Void
  private var panel: NSPanel?
  private var screen = CGRect.zero
  private var input = InkInput()
  private let liveLayer = CAShapeLayer()
  private var fading: [(layer: CAShapeLayer, since: Double)] = []
  private var timer: Timer?
  /// KLADD_TEST_INK=1 scripts ⇧ and the pointer: one stroke from t = 1 s to 2 s, so the ink can be
  /// checked in screen.mp4 and marks.jsonl without real input.
  private let scripted = ProcessInfo.processInfo.environment["KLADD_TEST_INK"] != nil

  /// `clock` is the clip's `t`; `finished` gets each stroke once ⇧ is let go.
  init(clock: @escaping () -> Double, finished: @escaping (InkStroke) -> Void) {
    self.clock = clock
    self.finished = finished
  }

  func start() {
    let mainID = CGMainDisplayID()
    guard let main = NSScreen.screens.first(where: {
      ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == mainID
    }) else { return logError("no main screen to draw ink on") }
    screen = main.frame
    let panel = NSPanel(
      contentRect: screen, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.ignoresMouseEvents = true
    panel.hidesOnDeactivate = false
    panel.level = NSWindow.Level(Int(CGWindowLevelForKey(.statusWindow)) + 1)
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    let view = NSView(frame: CGRect(origin: .zero, size: screen.size))
    view.wantsLayer = true
    panel.contentView = view
    panel.setFrame(screen, display: false)
    style(liveLayer)
    view.layer?.addSublayer(liveLayer)
    panel.orderFrontRegardless()
    self.panel = panel
    let timer = Timer(timeInterval: inkPollInterval, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.poll() } }
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
  }

  /// Writes the stroke being drawn, if any, and stops drawing.
  func stop() {
    timer?.invalidate()
    if let stroke = input.finish() { finished(stroke) }
  }

  private func style(_ layer: CAShapeLayer) {
    layer.strokeColor = inkColor
    layer.fillColor = nil
    layer.lineWidth = inkWidth
    layer.lineCap = .round
    layer.lineJoin = .round
    layer.frame = CGRect(origin: .zero, size: screen.size)
  }

  private func poll() {
    // Both states, as Scrawl does: the combined one also has virtual keyboards such as Karabiner's.
    let flags = CGEventSource.flagsState(.combinedSessionState).union(CGEventSource.flagsState(.hidSystemState))
    var pointer = NSEvent.mouseLocation
    let now = clock()
    var shift = flags.contains(.maskShift)
    var otherModifiers = !flags.isDisjoint(with: [.maskCommand, .maskControl, .maskAlternate])
    if scripted {
      shift = now >= 1 && now < 2
      otherModifiers = false
      pointer = CGPoint(x: screen.minX + 200 + 400 * (now - 1), y: screen.maxY - 200 - 200 * (now - 1))
    }
    let point = screen.contains(pointer) ? CGPoint(x: pointer.x - screen.minX, y: screen.maxY - pointer.y) : nil
    let stroke = input.poll(shift: shift, otherModifiers: otherModifiers, point: point, at: now)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if let stroke {
      finished(stroke)
      let layer = CAShapeLayer()
      style(layer)
      layer.path = inkPath(stroke.points, height: screen.height)
      liveLayer.superlayer?.addSublayer(layer)
      fading.append((layer, now))
    }
    let live = input.live.flatMap { $0.isInk ? $0.points : nil }
    liveLayer.path = live.map { inkPath($0, height: screen.height) }
    fading.removeAll { entry in
      guard let opacity = inkOpacity(age: now - entry.since) else {
        entry.layer.removeFromSuperlayer()
        return true
      }
      entry.layer.opacity = Float(opacity)
      return false
    }
    CATransaction.commit()
  }
}
