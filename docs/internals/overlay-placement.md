# Overlay placement

How the logging overlay ends up next to where the user writes.

1. **Focus tracking.** platform-darwin's `FocusTracker` layer wraps a Swift module built with node-swift. It calls macOS Accessibility (`AXFocusedUIElement`, `AXBoundsForRange` on the selected range) and `NSWorkspace`, and streams `FocusSnapshot`s: front app, window frame, focused element frame, and caret rect.
2. **Any rect can be missing.** Electron and Chromium apps (Slack, Notion, VS Code) usually report no caret, canvas editors report no element, and without Accessibility permission there's nothing at all. In that last case the overlay uses a fixed position.
3. **Anchor.** The adapter matching the front app's bundle id picks the anchor rect. `Generic` (caret, then element, then window) covers apps without an adapter.
4. **Placement.** `placeOverlay(anchor, size, screen)` in domain is pure: right of the anchor, flipped at screen edges.
5. **Moving the window.** Core calls the `OverlayWindows` port, which apps/desktop implements because only it may import Electron. Overlays are shown with `showInactive()` so the writing app keeps keyboard focus, and moved with animated `setBounds`.

AX coordinates have their origin at the top-left of the main screen, the same as Electron's screen coordinates, so rects pass through without flipping.
