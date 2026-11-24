import { join, resolve } from "node:path";
import { ClipCapture, FocusTracker, ScreenCapture, SessionCapture, Transcriber } from "@kladd/core";
import {
  FocusTrackerDarwin,
  ScreenCaptureDarwin,
  SessionCaptureDarwin,
  TranscriberDarwin,
} from "@kladd/platform-darwin";
import { app } from "electron";
import { Effect, Layer } from "effect";

const unsupported = Effect.die(`Kladd has no platform layer for ${process.platform} yet.`);

/**
 * The kladd-capture helper (screen capture and focus): shipped in Resources/capture
 * (electron-builder.yml), or straight from the Swift build in dev.
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
  Effect.sync(() => {
    if (process.platform !== "darwin") {
      return Layer.mergeAll(
        Layer.effect(ScreenCapture, unsupported),
        Layer.effect(FocusTracker, unsupported),
        Layer.effect(SessionCapture, unsupported),
        Layer.effect(ClipCapture, unsupported),
        Layer.effect(Transcriber, unsupported),
      );
    }
    const helper = captureHelper();
    return Layer.mergeAll(
      ScreenCaptureDarwin(helper),
      FocusTrackerDarwin(helper),
      // Clips are recorded by the session's helper, so one layer provides both.
      SessionCaptureDarwin(helper),
      // The Whisper model is downloaded once and shared by every recording.
      TranscriberDarwin(helper, join(app.getPath("userData"), "models")),
    );
  }),
);
