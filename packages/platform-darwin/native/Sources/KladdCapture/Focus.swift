// `kladd-capture focus`: where the user is, read from NSWorkspace and Accessibility (AX).
// Prints one JSON object shaped like FocusSnapshot in packages/domain/src/Focus.ts. Every field
// can be null. Without Accessibility permission only `app` is known.
// AX rects use points with the origin at the top-left of the main display, like Electron.

import AppKit
import ApplicationServices

/// How long one AX call may wait for an app that doesn't answer.
let axTimeout: Float = 0.5

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value
}

func childElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
  guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return (value as! AXUIElement)
}

func asAXValue(_ value: CFTypeRef?) -> AXValue? {
  guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
  return (value as! AXValue)
}

func point(_ value: CFTypeRef?) -> CGPoint? {
  var result = CGPoint.zero
  guard let value = asAXValue(value), AXValueGetValue(value, .cgPoint, &result) else { return nil }
  return result
}

func size(_ value: CFTypeRef?) -> CGSize? {
  var result = CGSize.zero
  guard let value = asAXValue(value), AXValueGetValue(value, .cgSize, &result) else { return nil }
  return result
}

func rect(_ value: CFTypeRef?) -> CGRect? {
  var result = CGRect.zero
  guard let value = asAXValue(value), AXValueGetValue(value, .cgRect, &result) else { return nil }
  return result
}

/// The element's on-screen frame, from its position and size.
func frame(_ element: AXUIElement) -> CGRect? {
  guard let origin = point(attribute(element, kAXPositionAttribute)),
    let size = size(attribute(element, kAXSizeAttribute)),
    size.width > 0, size.height > 0
  else { return nil }
  return CGRect(origin: origin, size: size)
}

/// The text cursor: the bounds of the selected range. Many Electron and Chromium apps don't report it.
func caret(_ element: AXUIElement) -> CGRect? {
  guard let range = attribute(element, kAXSelectedTextRangeAttribute) else { return nil }
  var bounds: CFTypeRef?
  guard
    AXUIElementCopyParameterizedAttributeValue(
      element, kAXBoundsForRangeParameterizedAttribute as CFString, range, &bounds) == .success,
    let bounds = rect(bounds),
    // Some apps answer with an empty rect at the origin instead of failing.
    bounds.height > 0
  else { return nil }
  return bounds
}

/// The first value `pick` finds in `element` or its descendants, depth first.
func firstInTree(_ element: AXUIElement, depth: Int = 0, _ pick: (AXUIElement) -> String?) -> String? {
  if let value = pick(element), !value.isEmpty { return value }
  guard depth < 4, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] else { return nil }
  for child in children {
    if let value = firstInTree(child, depth: depth + 1, pick) { return value }
  }
  return nil
}

/// How much of the window's AX tree `selection` reads: OneNote's sidebars are about 100 elements in.
let selectionMaxElements = 400
let selectionDeadline: TimeInterval = 0.2

/// The selected rows of every list (outline or table) in `window`, breadth first, such as the current
/// section and page in a sidebar. Each row is its first AXIdentifier, when the app sets one, and its
/// first text. Lists aren't walked row by row: AXSelectedRows names the selected ones.
func selection(_ window: AXUIElement) -> [[String: Any]] {
  let deadline = Date().addingTimeInterval(selectionDeadline)
  var queue = [window]
  var next = 0
  var items: [[String: Any]] = []
  while next < queue.count, next < selectionMaxElements, Date() < deadline {
    let element = queue[next]
    next += 1
    let role = attribute(element, kAXRoleAttribute) as? String
    guard role == kAXOutlineRole || role == kAXTableRole else {
      queue += attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
      continue
    }
    for row in attribute(element, kAXSelectedRowsAttribute) as? [AXUIElement] ?? [] {
      let id = firstInTree(row) { attribute($0, "AXIdentifier") as? String }
      let text = firstInTree(row) {
        attribute($0, kAXRoleAttribute) as? String == kAXStaticTextRole
          ? attribute($0, kAXValueAttribute) as? String : nil
      }
      items.append(["id": id ?? NSNull(), "text": text ?? NSNull()])
    }
  }
  return items
}

func json(_ rect: CGRect?) -> Any {
  guard let rect else { return NSNull() }
  return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
}

/// The app the user is in. The pill menu makes Kladd the active app (and it stays so after the
/// menu closes), so when `excludePid` is in front this is the owner of the topmost normal window
/// that isn't Kladd's: the app the user was in. Reading window owners needs no permission.
func userApp(excludePid: pid_t?) -> NSRunningApplication? {
  let front = NSWorkspace.shared.frontmostApplication
  if let front, front.processIdentifier != excludePid { return front }
  let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  // Front to back. Layer 0 is normal windows: not the menu bar, Dock or Kladd's floating overlays.
  for window in windows {
    guard (window[kCGWindowLayer as String] as? Int) == 0,
      let pid = window[kCGWindowOwnerPID as String] as? pid_t, pid != excludePid,
      let app = NSRunningApplication(processIdentifier: pid), app.activationPolicy == .regular
    else { continue }
    return app
  }
  return nil
}

func focusSnapshot(excludePid: pid_t?) -> [String: Any] {
  var snapshot: [String: Any] = [
    "app": NSNull(), "window": NSNull(), "title": NSNull(), "element": NSNull(), "caret": NSNull(),
    "selection": [],
  ]
  // An app's focused window and element stay readable over AX while it is in the background.
  guard let front = userApp(excludePid: excludePid), let bundleId = front.bundleIdentifier
  else { return snapshot }
  snapshot["app"] = ["bundleId": bundleId, "name": front.localizedName ?? bundleId]
  guard AXIsProcessTrusted() else { return snapshot }

  // Set on the system-wide element, it applies to every element; set on the app, only to the app.
  AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), axTimeout)
  let app = AXUIElementCreateApplication(front.processIdentifier)
  if let window = childElement(app, kAXFocusedWindowAttribute) {
    snapshot["window"] = json(frame(window))
    if let title = attribute(window, kAXTitleAttribute) as? String, !title.isEmpty { snapshot["title"] = title }
    snapshot["selection"] = selection(window)
  }
  if let element = childElement(app, kAXFocusedUIElementAttribute) {
    snapshot["element"] = json(frame(element))
    snapshot["caret"] = json(caret(element))
  }
  return snapshot
}

func printFocus(excludePid: pid_t?) {
  do {
    let data = try JSONSerialization.data(withJSONObject: focusSnapshot(excludePid: excludePid))
    say(String(decoding: data, as: UTF8.self))
  } catch {
    fail("cannot encode focus: \(error)")
  }
}
