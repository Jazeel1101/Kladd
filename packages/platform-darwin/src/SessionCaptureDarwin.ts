import { SessionCapture } from "@kladd/core";
import { deniedPathFragments, excludedApps, noisyPathFragments } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, startCapture } from "./helper";

/**
 * macOS SessionCapture: one long-running `kladd-capture session` per recording
 * (../native/Sources/KladdCapture/Session.swift). The privacy lists live in domain, so they are
 * passed to the helper as JSON. See docs/internals/session-capture.md.
 */
export const SessionCaptureDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    SessionCapture,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const start = Effect.fn("SessionCaptureDarwin.start")(function* (dir: string) {
        return yield* startCapture(spawner, helper, [
          "session",
          "--dir",
          dir,
          "--exclude-pid",
          String(helper.excludePid),
          "--exclude-apps",
          JSON.stringify(excludedApps),
          "--deny-paths",
          JSON.stringify([...deniedPathFragments, ...noisyPathFragments]),
        ]);
      });

      return SessionCapture.of({ start });
    }),
  );
