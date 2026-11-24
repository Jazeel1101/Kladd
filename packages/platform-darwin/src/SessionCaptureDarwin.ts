import { ClipCapture, SessionCapture } from "@kladd/core";
import {
  deniedPathFragments,
  excludedApps,
  noisyPathFragments,
  ScreenCaptureFailed,
} from "@kladd/domain";
import { type Cause, Context, Deferred, Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, startCapture } from "./helper";

/** What the session helper prints about a clip (main.swift lists them). */
export type ClipAnswer =
  | { readonly _tag: "Recording" }
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Failed"; readonly reason: string };

export const parseClipAnswer = (line: string): ClipAnswer | null => {
  if (line === "clip-recording") return { _tag: "Recording" };
  if (line === "clip-stopped") return { _tag: "Stopped" };
  if (line.startsWith("clip-failed ")) {
    return { _tag: "Failed", reason: line.slice("clip-failed ".length) };
  }
  return null;
};

/** The clip the helper is starting or recording: done once it records, and once it has ended. */
interface ClipWaiters {
  readonly recording: Deferred.Deferred<void, ScreenCaptureFailed>;
  readonly ended: Deferred.Deferred<void, ScreenCaptureFailed>;
}

/** The running session helper, which clips are commands to. */
interface Running {
  readonly send: (line: string) => Effect.Effect<void>;
  readonly clip: Ref.Ref<Option.Option<ClipWaiters>>;
}

const failed = (reason: string) => new ScreenCaptureFailed({ reason });

/**
 * macOS SessionCapture and ClipCapture: one long-running `kladd-capture session` per recording
 * (../native/Sources/KladdCapture/Session.swift), which also records its clips on commands sent to
 * its stdin (Clip.swift): two helpers can't both use ScreenCaptureKit. The privacy lists live in
 * domain, so they are passed to the helper as JSON. See docs/internals/session-capture.md.
 */
export const SessionCaptureDarwin = (helper: CaptureHelper) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const current = yield* Ref.make(Option.none<Running>());

      const start = Effect.fn("SessionCaptureDarwin.start")(function* (dir: string) {
        const stdin = yield* Queue.unbounded<string, Cause.Done>();
        const capture = yield* startCapture(
          spawner,
          helper,
          [
            "session",
            "--dir",
            dir,
            "--exclude-pid",
            String(helper.excludePid),
            "--exclude-apps",
            JSON.stringify(excludedApps),
            "--deny-paths",
            JSON.stringify([...deniedPathFragments, ...noisyPathFragments]),
          ],
          Stream.fromQueue(stdin).pipe(Stream.encodeText),
        );
        const clip = yield* Ref.make(Option.none<ClipWaiters>());
        const running: Running = { send: (line) => Queue.offer(stdin, `${line}\n`), clip };

        const end = (waiters: ClipWaiters, failure: ScreenCaptureFailed | null) =>
          Ref.set(clip, Option.none()).pipe(
            Effect.andThen(
              Deferred.fail(
                waiters.recording,
                failure ?? failed("the clip stopped before it recorded"),
              ),
            ),
            Effect.andThen(
              failure === null
                ? Deferred.succeed(waiters.ended, undefined)
                : Deferred.fail(waiters.ended, failure),
            ),
          );
        const answer = Effect.fn("SessionCaptureDarwin.answer")(function* (line: string) {
          const parsed = parseClipAnswer(line);
          const waiters = yield* Ref.get(clip);
          if (parsed === null || Option.isNone(waiters)) {
            return yield* Effect.logWarning("Unexpected line from kladd-capture session", line);
          }
          if (parsed._tag === "Recording") {
            yield* Deferred.succeed(waiters.value.recording, undefined);
          } else {
            yield* end(waiters.value, parsed._tag === "Failed" ? failed(parsed.reason) : null);
          }
        });
        // Once the helper has exited, no clip can start or finish.
        const exited = Effect.gen(function* () {
          yield* Ref.update(current, (now) =>
            Option.contains(now, running) ? Option.none() : now,
          );
          const waiters = yield* Ref.get(clip);
          if (Option.isSome(waiters)) {
            yield* end(waiters.value, failed("kladd-capture session exited during the clip"));
          }
        });
        yield* capture.lines.pipe(
          Stream.runForEach(answer),
          Effect.ensuring(exited),
          Effect.forkScoped,
        );

        yield* Effect.acquireRelease(Ref.set(current, Option.some(running)), () => exited);
        return { stop: capture.stop };
      });

      const startClip = Effect.fn("SessionCaptureDarwin.startClip")(function* (dir: string) {
        const running = yield* Ref.get(current);
        if (Option.isNone(running)) return yield* failed("no session is recording");
        if (dir.includes("\n")) return yield* failed(`bad clip folder: ${dir}`);
        const { send, clip } = running.value;
        const waiters: ClipWaiters = {
          recording: yield* Deferred.make<void, ScreenCaptureFailed>(),
          ended: yield* Deferred.make<void, ScreenCaptureFailed>(),
        };
        yield* Ref.set(clip, Option.some(waiters));

        // Waits for the helper to finish the clip, so the next one starts clean.
        const stop = Effect.gen(function* () {
          if (!(yield* Deferred.isDone(waiters.ended))) yield* send("clip-stop");
          yield* Deferred.await(waiters.ended);
        }).pipe(Effect.withSpan("SessionCaptureDarwin.stopClip"));

        yield* Effect.addFinalizer(() => Effect.ignore(stop));
        yield* send(`clip-start ${dir}`);
        yield* Deferred.await(waiters.recording).pipe(
          Effect.onInterrupt(() => Effect.ignore(stop)),
        );
        return { stop };
      });

      return Context.make(SessionCapture, SessionCapture.of({ start })).pipe(
        Context.add(ClipCapture, ClipCapture.of({ start: startClip })),
      );
    }),
  );
