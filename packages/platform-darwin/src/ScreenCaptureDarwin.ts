import { ScreenCapture } from "@kladd/core";
import { ScreenCaptureFailed, type ScreenCapturePermission } from "@kladd/domain";
import { Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
import {
  type CaptureHelper,
  captureFailed,
  captureResult,
  describeFailure,
  type HelperResult,
  parsePermission,
  runHelper,
  screenshotTimeout,
  startCapture,
} from "./helper";
import { SessionHelper } from "./SessionCaptureDarwin";

/**
 * macOS ScreenCapture. Each call runs the Swift helper in ../native (ScreenCaptureKit, plus
 * PermissionFlow to guide the user through System Settings). A child process of Kladd counts as
 * Kladd for screen recording permission. Build the helper with `vp run @kladd/platform-darwin#build:native`.
 * While a session runs, its helper takes the screenshots (SessionHelper).
 */
export const ScreenCaptureDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    ScreenCapture,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const session = yield* SessionHelper;

      /** Runs the helper to completion. A failure to start it is ScreenCaptureFailed. */
      const run = (args: ReadonlyArray<string>) =>
        runHelper(spawner, helper, args).pipe(Effect.mapError(captureFailed));

      const readPermission = (
        result: HelperResult,
      ): Effect.Effect<ScreenCapturePermission, ScreenCaptureFailed> => {
        const permission = parsePermission(result);
        return permission === null
          ? Effect.fail(new ScreenCaptureFailed({ reason: describeFailure(result) }))
          : Effect.succeed(permission);
      };

      const permission = run(["status"]).pipe(
        Effect.flatMap(readPermission),
        Effect.withSpan("ScreenCaptureDarwin.permission"),
      );

      // The helper exits when the user grants it, closes the panel, quits System Settings, or after
      // 5 minutes. Permission is read again in a fresh process: macOS may only apply it to new ones.
      const requestPermission = run(["request", "--app", helper.appBundle]).pipe(
        Effect.flatMap(readPermission),
        Effect.andThen(permission),
        Effect.withSpan("ScreenCaptureDarwin.requestPermission"),
      );

      const pid = String(helper.excludePid);

      const screenshot = Effect.fn("ScreenCaptureDarwin.screenshot")(function* (file: string) {
        if (yield* session.screenshot(file)) return;
        const result = yield* run(["screenshot", "--out", file, "--exclude-pid", pid]).pipe(
          Effect.timeoutOrElse({
            duration: screenshotTimeout,
            orElse: () => Effect.fail(new ScreenCaptureFailed({ reason: "screenshot timed out" })),
          }),
        );
        yield* captureResult(result);
      });

      const recordVideo = Effect.fn("ScreenCaptureDarwin.recordVideo")(function* (file: string) {
        return yield* startCapture(spawner, helper, [
          "record",
          "--out",
          file,
          "--exclude-pid",
          pid,
        ]);
      });

      return ScreenCapture.of({ permission, requestPermission, screenshot, recordVideo });
    }),
  );
