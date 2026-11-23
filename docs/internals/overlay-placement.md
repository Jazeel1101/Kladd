# Overlay placement

How the logging overlay ends up next to where the user writes. Entry point: `LoggingOverlay.open` in `packages/core/src/logging/LoggingOverlay.ts`, called when a recording stops.

1. **Focus.** The `FocusTracker` port returns a `FocusSnapshot`: front app, window frame, focused element frame and caret rect. On macOS it is meant to wrap a Swift module built with node-swift that reads Accessibility (`AXFocusedUIElement`, `AXBoundsForRange` on the selected range) and `NSWorkspace`. `FocusTrackerDarwin` is still a stub that reports nothing.
2. **Any rect can be null.** Electron and Chromium apps (Slack, Notion, VS Code) usually report no caret, canvas editors report no element, and without Accessibility permission nothing is known.
3. **Anchor.** `adapterFor` picks the adapter for the front app's bundle id, else `Generic`. The adapter returns the anchor rect, or null.
4. **Placement.** `placeOverlay` in `packages/domain/src/Placement.ts` is pure: right of the anchor, flipped left when that doesn't fit, clamped to the display's work area. With no anchor, `placeWithoutAnchor` centres it at the right screen edge.
5. **Showing.** Core calls the `OverlayWindows` port, implemented in `apps/desktop/src/main/windows.ts` because only desktop may import Electron. Overlays are `panel` windows shown with `showInactive()`, so the writing app keeps keyboard focus. Moving a window that is already visible is animated (`setBounds(bounds, true)`).

AX and Electron both use points with the origin at the top-left of the main display, so rects pass through unchanged. Displays left of or above the main one have negative coordinates.
