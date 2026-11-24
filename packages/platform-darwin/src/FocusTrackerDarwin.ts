import { FocusTracker } from "@kladd/core";
import { type AccessibilityPermission, FocusSnapshot, FocusTrackingFailed } from "@kladd/domain";
import { Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  type CaptureHelper,
  describeFailure,
  type HelperResult,
  parsePermission,
  runHelper,
} from "./helper";

const failed = (cause: unknown) =>
  new FocusTrackingFailed({ reason: cause instanceof Error ? cause.message : String(cause) });

const decodeFocus = Schema.decodeUnknownEffect(Schema.fromJsonString(FocusSnapshot));

/**
 * macOS FocusTracker: runs `kladd-capture focus` (../native/Sources/KladdCapture/Focus.swift), which
 * reads NSWorkspace and Accessibility. Like screen recording, Accessibility permission is Kladd's,
 * since the helper is Kladd's child. See docs/internals/overlay-placement.md.
 */
export const FocusTrackerDarwin = (helper: CaptureHelper) =>
  Layer.effect(
    FocusTracker,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const run = (args: ReadonlyArray<string>) =>
        runHelper(spawner, helper, args).pipe(Effect.mapError(failed));

      const readPermission = (
        result: HelperResult,
      ): Effect.Effect<AccessibilityPermission, FocusTrackingFailed> => {
        const permission = parsePermission(result);
        return permission === null
          ? Effect.fail(new FocusTrackingFailed({ reason: describeFailure(result) }))
          : Effect.succeed(permission);
      };

      const current = run(["focus", "--exclude-pid", String(helper.excludePid)]).pipe(
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? decodeFocus(result.stdout).pipe(Effect.mapError(failed))
            : Effect.fail(new FocusTrackingFailed({ reason: describeFailure(result) })),
        ),
        Effect.withSpan("FocusTrackerDarwin.current"),
      );

      // One long-running helper per watch: it prints a line per change and exits when its stdin
      // closes, which happens when the stream is interrupted or Kladd goes away.
      const watch = Stream.unwrap(
        Effect.gen(function* () {
          const handle = yield* spawner
            .spawn(
              ChildProcess.make(helper.path, [
                "watch-focus",
                "--exclude-pid",
                String(helper.excludePid),
              ]),
            )
            .pipe(Effect.mapError(failed));
          const snapshots = handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.mapEffect((line) => decodeFocus(line)),
            Stream.mapError(failed),
          );
          const exited = Stream.fromEffect(handle.exitCode.pipe(Effect.mapError(failed))).pipe(
            Stream.flatMap((code) =>
              Number(code) === 0
                ? Stream.empty
                : Stream.fail(
                    new FocusTrackingFailed({ reason: `watch-focus exited with ${code}` }),
                  ),
            ),
          );
          return Stream.concat(snapshots, exited);
        }),
      ).pipe(Stream.withSpan("FocusTrackerDarwin.watch"));

      const permission = run(["accessibility-status"]).pipe(
        Effect.flatMap(readPermission),
        Effect.withSpan("FocusTrackerDarwin.permission"),
      );

      // Like ScreenCaptureDarwin.requestPermission: read again in a fresh process afterwards.
      const requestPermission = run(["accessibility-request", "--app", helper.appBundle]).pipe(
        Effect.flatMap(readPermission),
        Effect.andThen(permission),
        Effect.withSpan("FocusTrackerDarwin.requestPermission"),
      );

      return FocusTracker.of({ current, watch, permission, requestPermission });
    }),
  );
