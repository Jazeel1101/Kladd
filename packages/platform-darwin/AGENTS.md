# @kladd/platform-darwin

macOS implementations of core ports: screen capture and focus tracking (`FocusTracker`). Windows themselves live in apps/desktop.
Imports: `@kladd/core`, `@kladd/domain`, any npm package, `node:*`.
Copy: `src/FocusTrackerDarwin.ts`. Running the helper is shared in `src/helper.ts`.
Both run the Swift helper in `native/` (ScreenCaptureKit, Accessibility, PermissionFlow): `docs/internals/screen-capture.md`, `docs/internals/overlay-placement.md`.
A future `platform-win32` exports the same layers; `apps/desktop/src/main/platform.ts` picks one per OS.
