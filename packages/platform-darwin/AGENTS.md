# @kladd/platform-darwin

macOS implementations of core ports: screen capture and focus tracking (`FocusTracker`). Windows themselves live in apps/desktop.
Imports: `@kladd/core`, `@kladd/domain`, any npm package, `node:*`.
Copy: `src/ScreenCaptureDarwin.ts`. Both layers are stubs for now.
A future `platform-win32` exports the same layers; `apps/desktop/src/main/platform.ts` picks one per OS.
