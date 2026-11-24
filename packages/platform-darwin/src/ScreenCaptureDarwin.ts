import { ScreenCapture } from "@kladd/core";
import {
  ScreenCaptureFailed,
  ScreenCapturePermissionDenied,
  type ScreenCapturePermission,
} from "@kladd/domain";
import { Effect, Fiber, Layer, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  type CaptureHelper,
  describeFailure,
  exitDenied,
  type HelperResult,
  parsePermission,
  runHelper,
  text,
} from "./helper";

const failed = (cause: unknown) =>
  new ScreenCaptureFailed({ reason: cause instanceof Error ? cause.message : String(cause) });

/**
 * macOS ScreenCapture. Each call runs the Swift helper in ../native (ScreenCaptureKit, plus
 * PermissionFlow to guide the user through System Settings). A child process of Kladd counts as
 * Kladd for screen recording permission. Build the helper with `vp run @kladd/platform-darwin#build:native`.
 */
export const ScreenCaptureDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    ScreenCapture,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** Runs the helper to completion. A failure to start it is ScreenCaptureFailed. */
      const run = (args: ReadonlyArray<string>) =>
        runHelper(spawner, helper, args).pipe(Effect.mapError(failed));

      const toResult = (result: { stderr: string; exitCode: number }) =>
        result.exitCode === 0
          ? Effect.void
          : result.exitCode === exitDenied
            ? Effect.fail(new ScreenCapturePermissionDenied({}))
            : Effect.fail(
                new ScreenCaptureFailed({ reason: result.stderr || `exit ${result.exitCode}` }),
              );

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
        yield* toResult(yield* run(["screenshot", "--out", file, "--exclude-pid", pid]));
      });

      const recordVideo = Effect.fn("ScreenCaptureDarwin.recordVideo")(function* (file: string) {
        // SIGINT makes the helper finish the file and exit. Closing the scope without `stop` does
        // the same and waits, but can't report a failure.
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(helper.path, ["record", "--out", file, "--exclude-pid", pid], {
              killSignal: "SIGINT",
              forceKillAfter: "10 seconds",
            }),
          )
          .pipe(Effect.mapError(failed));
        const stderr = yield* Effect.forkScoped(text(handle.stderr));
        const exited = Effect.gen(function* () {
          return yield* toResult({
            exitCode: Number(yield* handle.exitCode.pipe(Effect.mapError(failed))),
            stderr: yield* Fiber.join(stderr).pipe(Effect.orElseSucceed(() => "")),
          });
        });

        const first = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runHead,
          Effect.mapError(failed),
        );
        if (!Option.contains(first, "recording")) {
          // Anything else means the helper exited without recording.
          yield* exited;
          return yield* new ScreenCaptureFailed({
            reason: "kladd-capture exited before recording",
          });
        }

        // Killing an already-exited helper fails; its exit status is the real answer either way.
        const stop = handle.kill({ killSignal: "SIGINT", forceKillAfter: "10 seconds" }).pipe(
          Effect.ignore,
          Effect.andThen(exited),
          // The helper only exits with 77 before it records, so a later failure is never "denied".
          Effect.catchTag("ScreenCapturePermissionDenied", () =>
            Effect.fail(
              new ScreenCaptureFailed({ reason: "recording stopped: permission revoked" }),
            ),
          ),
          Effect.withSpan("ScreenCaptureDarwin.recordVideo.stop"),
        );
        return { stop };
      });

      return ScreenCapture.of({ permission, requestPermission, screenshot, recordVideo });
    }),
  );
