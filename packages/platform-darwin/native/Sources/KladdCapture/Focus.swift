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

func json(_ rect: CGRect?) -> Any {
  guard let rect else { return NSNull() }
  return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
}

func focusSnapshot(excludePid: pid_t?) -> [String: Any] {
  var snapshot: [String: Any] = [
    "app": NSNull(), "window": NSNull(), "title": NSNull(), "element": NSNull(), "caret": NSNull(),
  ]
  // Kladd's overlays don't take focus, so Kladd in front means one of its normal windows (Settings).
  guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != excludePid,
    let bundleId = front.bundleIdentifier
  else { return snapshot }
  snapshot["app"] = ["bundleId": bundleId, "name": front.localizedName ?? bundleId]
  guard AXIsProcessTrusted() else { return snapshot }

  let app = AXUIElementCreateApplication(front.processIdentifier)
  AXUIElementSetMessagingTimeout(app, axTimeout)
  if let window = childElement(app, kAXFocusedWindowAttribute) {
    snapshot["window"] = json(frame(window))
    if let title = attribute(window, kAXTitleAttribute) as? String, !title.isEmpty { snapshot["title"] = title }
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
