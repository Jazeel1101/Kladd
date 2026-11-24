# @kladd/platform-darwin

macOS implementations of core ports: screen capture and focus tracking (`FocusTracker`). Windows themselves live in apps/desktop.
Imports: `@kladd/core`, `@kladd/domain`, any npm package, `node:*`.
Copy: `src/ScreenCaptureDarwin.ts`. `FocusTrackerDarwin` is still a stub.
Screen capture runs the Swift helper in `native/` (ScreenCaptureKit + PermissionFlow): `docs/internals/screen-capture.md`.
A future `platform-win32` exports the same layers; `apps/desktop/src/main/platform.ts` picks one per OS.
