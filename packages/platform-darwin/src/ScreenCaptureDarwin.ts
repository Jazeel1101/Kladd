import { ScreenCapture } from "@kladd/core";
import { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import { Effect, Fiber, Layer, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Where the kladd-capture helper is and what it should know about Kladd. apps/desktop fills it in. */
export interface CaptureHelper {
  /** The kladd-capture binary built from ../native. */
  readonly path: string;
  /** Kladd's .app bundle, offered in PermissionFlow's drag-to-authorize panel. */
  readonly appBundle: string;
  /** Kladd's process: its windows (pill, overlays) are left out of captures. */
  readonly excludePid: number;
}

/** kladd-capture's exit code for "permission denied" (EX_NOPERM). */
const exitDenied = 77;

const failed = (cause: unknown) =>
  new ScreenCaptureFailed({ reason: cause instanceof Error ? cause.message : String(cause) });

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.map((s) => s.trim()),
  );

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

      /** Runs the helper to completion. A failure to start it, or a crash, is ScreenCaptureFailed. */
      const run = (args: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make(helper.path, args));
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [text(handle.stdout), text(handle.stderr), handle.exitCode],
            { concurrency: "unbounded" },
          );
          return { stdout, stderr, exitCode: Number(exitCode) };
        }).pipe(Effect.scoped, Effect.mapError(failed));

      const toResult = (result: { stderr: string; exitCode: number }) =>
        result.exitCode === 0
          ? Effect.void
          : result.exitCode === exitDenied
            ? Effect.fail(new ScreenCapturePermissionDenied({}))
            : Effect.fail(
                new ScreenCaptureFailed({ reason: result.stderr || `exit ${result.exitCode}` }),
              );

      const permission = run(["status"]).pipe(
        Effect.map((result) => (result.stdout === "granted" ? "granted" : "denied")),
        Effect.withSpan("ScreenCaptureDarwin.permission"),
      );

      // The helper exits when the user grants it, quits System Settings, or after 5 minutes.
      // Permission is read again in a fresh process: macOS may only apply it to new processes.
      const requestPermission = run(["request", "--app", helper.appBundle]).pipe(
        Effect.andThen(permission),
        Effect.withSpan("ScreenCaptureDarwin.requestPermission"),
      );

      const pid = String(helper.excludePid);

      const screenshot = Effect.fn("ScreenCaptureDarwin.screenshot")(function* (file: string) {
        yield* toResult(yield* run(["screenshot", "--out", file, "--exclude-pid", pid]));
      });

      const recordVideo = Effect.fn("ScreenCaptureDarwin.recordVideo")(function* (file: string) {
        // Closing the scope sends SIGINT; the helper finishes the file and exits, and the scope waits.
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(helper.path, ["record", "--out", file, "--exclude-pid", pid], {
              killSignal: "SIGINT",
              forceKillAfter: "10 seconds",
            }),
          )
          .pipe(Effect.mapError(failed));
        const stderr = yield* Effect.forkScoped(text(handle.stderr));
        const first = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runHead,
          Effect.mapError(failed),
        );
        if (Option.contains(first, "recording")) return;
        // Anything else means the helper exited without recording.
        yield* toResult({
          exitCode: Number(yield* handle.exitCode.pipe(Effect.mapError(failed))),
          stderr: yield* Fiber.join(stderr).pipe(Effect.orElseSucceed(() => "")),
        });
        return yield* new ScreenCaptureFailed({ reason: "kladd-capture exited before recording" });
      });

      return ScreenCapture.of({ permission, requestPermission, screenshot, recordVideo });
    }),
  );
