import { ClipCapture } from "@kladd/core";
import { excludedApps } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, startCapture } from "./helper";

/**
 * macOS ClipCapture: one long-running `kladd-capture clip` per clip
 * (../native/Sources/KladdCapture/Clip.swift), which also draws the ink. See
 * docs/internals/session-capture.md.
 */
export const ClipCaptureDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    ClipCapture,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const start = Effect.fn("ClipCaptureDarwin.start")(function* (dir: string) {
        return yield* startCapture(spawner, helper, [
          "clip",
          "--dir",
          dir,
          "--exclude-pid",
          String(helper.excludePid),
          "--exclude-apps",
          JSON.stringify(excludedApps),
        ]);
      });

      return ClipCapture.of({ start });
    }),
  );
