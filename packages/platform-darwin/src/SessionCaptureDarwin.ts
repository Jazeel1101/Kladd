import { ClipCapture, SessionCapture } from "@kladd/core";
import { excludedApps, ScreenCaptureFailed } from "@kladd/domain";
import { type Cause, Context, Deferred, Effect, Layer, Option, Queue, Ref, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { type CaptureHelper, screenshotTimeout, startCapture } from "./helper";

/** What the session helper prints after "recording" (main.swift lists them). */
export type SessionAnswer =
  | { readonly _tag: "ClipRecording" }
  | { readonly _tag: "ClipStopped" }
  | { readonly _tag: "ClipFailed"; readonly reason: string }
  | { readonly _tag: "ScreenshotSaved"; readonly file: string }
  | { readonly _tag: "ScreenshotFailed"; readonly file: string };

const afterPrefix = (line: string, prefix: string): string | null =>
  line.startsWith(prefix) && line.length > prefix.length ? line.slice(prefix.length) : null;

export const parseSessionAnswer = (line: string): SessionAnswer | null => {
  if (line === "clip-recording") return { _tag: "ClipRecording" };
  if (line === "clip-stopped") return { _tag: "ClipStopped" };
  const reason = afterPrefix(line, "clip-failed ");
  if (reason !== null) return { _tag: "ClipFailed", reason };
  const saved = afterPrefix(line, "screenshot-saved ");
  if (saved !== null) return { _tag: "ScreenshotSaved", file: saved };
  const failed = afterPrefix(line, "screenshot-failed ");
  if (failed !== null) return { _tag: "ScreenshotFailed", file: failed };
  return null;
};

/** The clip the helper is starting or recording: done once it records, and once it has ended. */
interface ClipWaiters {
  readonly recording: Deferred.Deferred<void, ScreenCaptureFailed>;
  readonly ended: Deferred.Deferred<void, ScreenCaptureFailed>;
}

/** The running session helper, which clips and screenshots are commands to. */
interface Running {
  readonly send: (line: string) => Effect.Effect<void>;
  readonly clip: Ref.Ref<Option.Option<ClipWaiters>>;
  /** Screenshots asked for and not answered yet, by file. */
  readonly screenshots: Ref.Ref<ReadonlyMap<string, Deferred.Deferred<void, ScreenCaptureFailed>>>;
}

const failed = (reason: string) => new ScreenCaptureFailed({ reason });

/**
 * The running session helper, for ScreenCaptureDarwin: while it runs it must take the screenshot,
 * since two helpers can't both use ScreenCaptureKit. Provided by SessionCaptureDarwin.
 */
export class SessionHelper extends Context.Service<
  SessionHelper,
  {
    /**
     * Saves the main display as a PNG at `file` through the running session helper. Succeeds with
     * false, doing nothing, when no session is running. Fails after `screenshotTimeout` unanswered.
     */
    readonly screenshot: (file: string) => Effect.Effect<boolean, ScreenCaptureFailed>;
  }
>()("kladd/platform-darwin/SessionHelper") {}

/**
 * macOS SessionCapture and ClipCapture: one long-running `kladd-capture session` per recording
 * (../native/Sources/KladdCapture/Session.swift), which also records its clips (Clip.swift) and
 * takes screenshots (SessionHelper) on commands sent to its stdin: two helpers can't both use
 * ScreenCaptureKit. The excluded apps live in domain, so they are passed to the helper as JSON.
 * See docs/internals/session-capture.md.
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
          ],
          Stream.fromQueue(stdin).pipe(Stream.encodeText),
        );
        const clip = yield* Ref.make(Option.none<ClipWaiters>());
        const screenshots = yield* Ref.make<
          ReadonlyMap<string, Deferred.Deferred<void, ScreenCaptureFailed>>
        >(new Map());
        const running: Running = {
          send: (line) => Queue.offer(stdin, `${line}\n`),
          clip,
          screenshots,
        };

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
        const answered = (file: string, failure: ScreenCaptureFailed | null) =>
          Effect.flatMap(Ref.get(screenshots), (all) => {
            const done = all.get(file);
            if (done === undefined) return Effect.logWarning("Unasked screenshot answer", file);
            return failure === null
              ? Deferred.succeed(done, undefined)
              : Deferred.fail(done, failure);
          });
        const answer = Effect.fn("SessionCaptureDarwin.answer")(function* (line: string) {
          const parsed = parseSessionAnswer(line);
          if (parsed === null) {
            return yield* Effect.logWarning("Unexpected line from kladd-capture session", line);
          }
          if (parsed._tag === "ScreenshotSaved") return yield* answered(parsed.file, null);
          if (parsed._tag === "ScreenshotFailed") {
            return yield* answered(parsed.file, failed("the session could not take a screenshot"));
          }
          const waiters = yield* Ref.get(clip);
          if (Option.isNone(waiters)) {
            return yield* Effect.logWarning("Clip answer with no clip", line);
          }
          if (parsed._tag === "ClipRecording") {
            yield* Deferred.succeed(waiters.value.recording, undefined);
          } else {
            yield* end(waiters.value, parsed._tag === "ClipFailed" ? failed(parsed.reason) : null);
          }
        });
        // Once the helper has exited, no clip can start or finish, and no screenshot be answered.
        const exited = Effect.gen(function* () {
          yield* Ref.update(current, (now) =>
            Option.contains(now, running) ? Option.none() : now,
          );
          const waiters = yield* Ref.get(clip);
          if (Option.isSome(waiters)) {
            yield* end(waiters.value, failed("kladd-capture session exited during the clip"));
          }
          for (const done of (yield* Ref.get(screenshots)).values()) {
            yield* Deferred.fail(
              done,
              failed("kladd-capture session exited before the screenshot"),
            );
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
        // The helper gives up on a clip with no first frame (clipFirstFrameWait in Clip.swift).
        yield* send(`clip-start ${dir}`);
        yield* Deferred.await(waiters.recording).pipe(
          Effect.onInterrupt(() => Effect.ignore(stop)),
        );
        return { stop };
      });

      const screenshot = Effect.fn("SessionCaptureDarwin.screenshot")(function* (file: string) {
        const running = yield* Ref.get(current);
        if (Option.isNone(running)) return false;
        if (file.includes("\n")) return yield* failed(`bad screenshot file: ${file}`);
        const { send, screenshots } = running.value;
        const done = yield* Deferred.make<void, ScreenCaptureFailed>();
        yield* Ref.update(screenshots, (all) => new Map(all).set(file, done));
        yield* send(`screenshot ${file}`);
        yield* Deferred.await(done).pipe(
          Effect.timeoutOrElse({
            duration: screenshotTimeout,
            orElse: () => Effect.fail(failed("the session took no screenshot in time")),
          }),
          Effect.ensuring(
            Ref.update(screenshots, (all) => {
              const left = new Map(all);
              left.delete(file);
              return left;
            }),
          ),
        );
        return true;
      });

      return Context.make(SessionCapture, SessionCapture.of({ start })).pipe(
        Context.add(ClipCapture, ClipCapture.of({ start: startClip })),
        Context.add(SessionHelper, SessionHelper.of({ screenshot })),
      );
    }),
  );
