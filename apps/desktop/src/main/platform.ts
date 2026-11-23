import { FocusTracker, ScreenCapture } from "@kladd/core";
import { FocusTrackerDarwin, ScreenCaptureDarwin } from "@kladd/platform-darwin";
import { Effect, Layer } from "effect";

const unsupported = Effect.die(`Kladd has no platform layer for ${process.platform} yet.`);

/**
 * Picks the OS layers for core's platform ports.
 * New OS: add packages/platform-<os> with the same layers and a branch here.
 */
export const PlatformLive = Layer.unwrap(
  Effect.sync(() =>
    process.platform === "darwin"
      ? Layer.mergeAll(ScreenCaptureDarwin, FocusTrackerDarwin)
      : Layer.mergeAll(
          Layer.effect(ScreenCapture, unsupported),
          Layer.effect(FocusTracker, unsupported),
        ),
  ),
);
