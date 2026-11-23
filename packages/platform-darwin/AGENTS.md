# @kladd/platform-darwin

macOS implementations of core ports: screen capture, active window, overlays.
Imports: `@kladd/core`, `@kladd/domain`, any npm package, `node:*`.
Copy: `src/ScreenCaptureDarwin.ts` (currently a stub).
A future `platform-win32` exports the same layers; `apps/desktop/src/main/platform.ts` picks one per OS.
