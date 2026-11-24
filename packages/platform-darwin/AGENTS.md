# @kladd/platform-darwin

macOS implementations of core ports: screen capture, focus tracking (`FocusTracker`) and session capture (`SessionCapture`). Windows themselves live in apps/desktop.
Imports: `@kladd/core`, `@kladd/domain`, any npm package, `node:*`.
Copy: `src/FocusTrackerDarwin.ts`. Running the helper is shared in `src/helper.ts`.
All run the Swift helper in `native/` (ScreenCaptureKit, Accessibility, PermissionFlow): `docs/internals/screen-capture.md`, `docs/internals/overlay-placement.md`, `docs/internals/session-capture.md`.
A future `platform-win32` exports the same layers; `apps/desktop/src/main/platform.ts` picks one per OS.
Test the helper with `vp run @kladd/platform-darwin#test:native` (synthetic frames and files; no display needed).
