# Screen capture on macOS

`ScreenCaptureDarwin` (`packages/platform-darwin/src/ScreenCaptureDarwin.ts`) runs `kladd-capture`, a Swift helper in `packages/platform-darwin/native`, once per call. Its usage is at the top of `native/Sources/KladdCapture/main.swift`.

- **Permission belongs to Kladd.** macOS attributes a child process's screen recording to the app that started it, so the grant is for Kladd (Electron.app in dev, or the terminal you launched it from).
- **Asking uses PermissionFlow** (`noxaur/PermissionFlow`): it opens System Settings → Screen Recording with a floating panel to drag Kladd.app into the list. `request` returns when the user grants it, quits System Settings, or after 5 minutes. Permission is then read again in a new process, because macOS may apply a grant only to processes started after it.
- **Video stops cleanly.** `record` finishes the file on SIGINT, SIGTERM or stdin closing (Kladd exited), and records at least 1 second, since ScreenCaptureKit writes no file for a shorter one. `stop` (or closing `recordVideo`'s scope) sends SIGINT and waits for the exit; only `stop` reports a failed file. Closing the PermissionFlow panel also ends `request`.
- **Building.** `vp run @kladd/platform-darwin#build:native` (`swift build`, needs Xcode). `pnpm dev` runs it first; `package` copies the binary and `PermissionFlow_PermissionFlow.bundle` (which it loads from beside itself) to `Resources/capture`. The helper needs macOS 15 (`SCRecordingOutput`).
- **Captures leave out Kladd's own windows** by excluding the Electron main process's pid.
