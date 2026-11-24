import { join, resolve } from "node:path";
import { FocusTracker, ScreenCapture } from "@kladd/core";
import { FocusTrackerDarwin, ScreenCaptureDarwin } from "@kladd/platform-darwin";
import { app } from "electron";
import { Effect, Layer } from "effect";

const unsupported = Effect.die(`Kladd has no platform layer for ${process.platform} yet.`);

/**
 * The kladd-capture helper: shipped in Resources/capture (electron-builder.yml), or straight from
 * the Swift build in dev.
 */
const captureHelper = () => ({
  path: app.isPackaged
    ? join(process.resourcesPath, "capture", "kladd-capture")
    : join(app.getAppPath(), "../../packages/platform-darwin/native/.build/release/kladd-capture"),
  // .../Kladd.app/Contents/MacOS/Kladd -> .../Kladd.app (Electron.app in dev).
  appBundle: resolve(app.getPath("exe"), "../../.."),
  excludePid: process.pid,
});

/**
 * Picks the OS layers for core's platform ports.
 * New OS: add packages/platform-<os> with the same layers and a branch here.
 */
export const PlatformLive = Layer.unwrap(
  Effect.sync(() =>
    process.platform === "darwin"
      ? Layer.mergeAll(ScreenCaptureDarwin(captureHelper()), FocusTrackerDarwin)
      : Layer.mergeAll(
          Layer.effect(ScreenCapture, unsupported),
          Layer.effect(FocusTracker, unsupported),
        ),
  ),
);
