import type { ScreenCapturePermissionDenied } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: captures the screen. Implemented per OS in packages/platform-<os>.
 * Test double: ScreenCaptureTest in ../testing.
 */
export class ScreenCapture extends Context.Service<
  ScreenCapture,
  {
    readonly start: Effect.Effect<void, ScreenCapturePermissionDenied>;
    readonly stop: Effect.Effect<void>;
  }
>()("kladd/core/ScreenCapture") {}
