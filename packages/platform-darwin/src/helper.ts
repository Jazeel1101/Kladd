import { ScreenCaptureFailed, ScreenCapturePermissionDenied } from "@kladd/domain";
import { Effect, Fiber, Option, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/** Where the kladd-capture helper is and what it should know about Kladd. apps/desktop fills it in. */
export interface CaptureHelper {
  /** The kladd-capture binary built from ../native. */
  readonly path: string;
  /** Kladd's .app bundle, offered in PermissionFlow's drag-to-authorize panel. */
  readonly appBundle: string;
  /** Kladd's process: its windows (pill, overlays) are left out of captures and focus. */
  readonly excludePid: number;
}

/** kladd-capture's exit code for "permission denied" (EX_NOPERM). */
const exitDenied = 77;

const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.map((s) => s.trim()),
  );

export interface HelperResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Runs the helper to completion. Fails only when it can't be started or read. */
export const runHelper = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  helper: CaptureHelper,
  args: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const handle = yield* spawner.spawn(ChildProcess.make(helper.path, args));
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [text(handle.stdout), text(handle.stderr), handle.exitCode],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, exitCode: Number(exitCode) } satisfies HelperResult;
  }).pipe(Effect.scoped);

/** `status`-style commands print the permission; anything else means the helper broke. */
export const parsePermission = ({ stdout, exitCode }: HelperResult): "granted" | "denied" | null =>
  exitCode === 0 && (stdout === "granted" || stdout === "denied") ? stdout : null;

export const describeFailure = ({ stdout, stderr, exitCode }: HelperResult): string =>
  stderr || `exit ${exitCode}: ${stdout}`;

export const captureFailed = (cause: unknown) =>
  new ScreenCaptureFailed({ reason: cause instanceof Error ? cause.message : String(cause) });

/** A capture command's exit: 0 is done, 77 is "permission denied", anything else failed. */
export const captureResult = (result: { stderr: string; exitCode: number }) =>
  result.exitCode === 0
    ? Effect.void
    : result.exitCode === exitDenied
      ? Effect.fail(new ScreenCapturePermissionDenied({}))
      : Effect.fail(
          new ScreenCaptureFailed({ reason: result.stderr || `exit ${result.exitCode}` }),
        );

/**
 * Starts a long-running capture command (`record`, `session`, `clip`) and succeeds once it prints
 * "recording". `stop` sends SIGINT, which makes the helper finish its files, and waits for the exit.
 * Closing the scope without `stop` does the same and waits, but can't report a failure.
 */
export const startCapture = Effect.fn("kladd-capture.start")(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  helper: CaptureHelper,
  args: ReadonlyArray<string>,
) {
  const handle = yield* spawner
    .spawn(
      ChildProcess.make(helper.path, args, {
        killSignal: "SIGINT",
        forceKillAfter: "30 seconds",
      }),
    )
    .pipe(Effect.mapError(captureFailed));
  const stderr = yield* Effect.forkScoped(text(handle.stderr));
  const exited = Effect.gen(function* () {
    return yield* captureResult({
      exitCode: Number(yield* handle.exitCode.pipe(Effect.mapError(captureFailed))),
      stderr: yield* Fiber.join(stderr).pipe(Effect.orElseSucceed(() => "")),
    });
  });

  const first = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runHead,
    Effect.mapError(captureFailed),
  );
  if (!Option.contains(first, "recording")) {
    // Anything else means the helper exited without recording.
    yield* exited;
    return yield* new ScreenCaptureFailed({ reason: "kladd-capture exited before recording" });
  }

  // Killing an already-exited helper fails; its exit status is the real answer either way.
  const stop = handle.kill({ killSignal: "SIGINT", forceKillAfter: "30 seconds" }).pipe(
    Effect.ignore,
    Effect.andThen(exited),
    // The helper only exits with 77 before it records, so a later failure is never "denied".
    Effect.catchTag("ScreenCapturePermissionDenied", () =>
      Effect.fail(new ScreenCaptureFailed({ reason: "recording stopped: permission revoked" })),
    ),
    Effect.withSpan("kladd-capture.stop"),
  );
  return { stop };
});
