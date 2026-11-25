// The privacy filter the session takes keyframes through and its clips record through: the main
// display minus Kladd's windows and the excluded apps. ScreenCaptureKit only excludes apps that are running,
// so the filter is rebuilt when one starts; until a filter that leaves it out is in use, `pending`.

import AppKit
import ScreenCaptureKit

/// Runs on the main queue.
@MainActor final class PrivacyFilter {
  let excludePid: pid_t?
  let excludedApps: Set<String>
  private(set) var filter: SCContentFilter?
  private(set) var display: SCDisplay?
  /// The pids the filter leaves out, to tell when an excluded app starts or quits.
  private(set) var filteredPids = Set<pid_t>()
  /// An excluded app launched and the capture may still show it.
  private(set) var pending = false
  var stopped = false
  /// The clip recording through the filter: it gets each new filter, and holds its frames while
  /// `pending`. Keyframes read `filter` when they are taken, so without a clip a filter is in use at once.
  var video: ClipVideo? {
    didSet { if pending { video?.hold() } }
  }

  init(excludePid: pid_t?, excludedApps: Set<String>) {
    self.excludePid = excludePid
    self.excludedApps = excludedApps
  }

  @discardableResult func load() async throws -> (SCContentFilter, SCDisplay) {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let mainID = CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first
    else { throw Failure(message: "no display to capture") }
    let excluded = content.applications.filter {
      $0.processID == excludePid || excludedApps.contains($0.bundleIdentifier)
    }
    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    filteredPids = Set(excluded.map(\.processID))
    self.filter = filter
    self.display = display
    return (filter, display)
  }

  func watchLaunches() {
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      guard let id = app?.bundleIdentifier else { return }
      MainActor.assumeIsolated {
        guard let self, self.excludedApps.contains(id) else { return }
        self.pending = true
        self.video?.hold()
        // Its first window can take a moment to be listed.
        for delay in [0.2, 1, 3] { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.refresh() } }
      }
    }
  }

  /// Every second: rebuilds the filter when an excluded app started or quit, or there is none yet.
  func check() {
    if filter == nil || runningExcludedPids() != filteredPids { refresh() }
  }

  func refresh() {
    Task { @MainActor in
      guard !stopped, let (filter, _) = try? await load() else { return }
      let filtered = filteredPids
      guard let video else { return accepted(filtered: filtered) }
      video.update(filter) { self.accepted(filtered: filtered) }
    }
  }

  /// A filter leaving out `filtered` is in use: capture goes on once it leaves out every excluded
  /// app. Checked now, not when the filter was built: another excluded app can have launched since.
  func accepted(filtered: Set<pid_t>) {
    guard pending, runningExcludedPids().isSubset(of: filtered) else { return }
    pending = false
    video?.release()
  }

  func runningExcludedPids() -> Set<pid_t> {
    Set(
      NSWorkspace.shared.runningApplications
        .filter { $0.processIdentifier == excludePid || excludedApps.contains($0.bundleIdentifier ?? "") }
        .map(\.processIdentifier))
  }
}
