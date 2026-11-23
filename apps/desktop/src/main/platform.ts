import { ScreenCapture } from "@kladd/core";
import { ScreenCaptureDarwin } from "@kladd/platform-darwin";
import { Effect, Layer } from "effect";

/**
 * Picks the OS layers for core's platform ports.
 * New OS: add packages/platform-<os> with the same layers and a branch here.
 */
export const PlatformLive = Layer.unwrap(
  Effect.sync(() =>
    process.platform === "darwin"
      ? ScreenCaptureDarwin
      : Layer.effect(
          ScreenCapture,
          Effect.die(`Kladd has no platform layer for ${process.platform} yet.`),
        ),
  ),
);
