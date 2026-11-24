import { Effect, Stream } from "effect";
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
export const exitDenied = 77;

export const text = <E>(stream: Stream.Stream<Uint8Array, E>) =>
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
