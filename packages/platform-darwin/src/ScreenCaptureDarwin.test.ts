import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClipCapture, ScreenCapture, SessionCapture } from "@kladd/core";
import { ScreenCaptureFailed } from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Fiber, FileSystem, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import { clipAnswerTimeout, screenshotTimeout } from "./helper";
import { ScreenCaptureDarwin } from "./ScreenCaptureDarwin";
import { SessionCaptureDarwin } from "./SessionCaptureDarwin";

/** The fake helper's temp dir. */
class FakeDir extends Context.Service<FakeDir, string>()("kladd/platform-darwin/test/FakeDir") {}

/**
 * A stand-in for kladd-capture, written as a shell script into a temp dir: `screenshot` hangs, as
 * ScreenCaptureKit can; `session` says "recording" and runs `onLine` for each stdin line, with the
 * command in $cmd and the rest in $rest. Each run writes its pid to `<dir>/pid`.
 */
const fakeHelper = (onLine: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const path = `${dir}/kladd-capture`;
      yield* fs.writeFileString(
        path,
        [
          "#!/bin/sh",
          `echo $$ > "${dir}/pid"`,
          'case "$1" in',
          "  screenshot) exec sleep 60 ;;",
          `  session) trap 'exit 0' INT; echo recording; while read cmd rest; do ${onLine}; done ;;`,
          "esac",
        ].join("\n"),
      );
      yield* fs.chmod(path, 0o755);
      const helper = { path, appBundle: "/Applications/Kladd.app", excludePid: 1 };
      return ScreenCaptureDarwin(helper).pipe(
        Layer.provideMerge(SessionCaptureDarwin(helper)),
        Layer.provideMerge(Layer.succeed(FakeDir, dir)),
      );
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

/** Whether a process is alive, by `kill -0`. */
const running = (pid: number) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const check = yield* spawner.spawn(ChildProcess.make("kill", ["-0", String(pid)]));
    return Number(yield* check.exitCode) === 0;
  }).pipe(Effect.scoped);

/** The fake helper's pid, once it has started. */
const fakePid = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = `${yield* FakeDir}/pid`;
  while (!(yield* fs.exists(file)) || (yield* fs.readFileString(file)).trim() === "") {
    yield* Effect.yieldNow;
  }
  return Number((yield* fs.readFileString(file)).trim());
});

describe("ScreenCaptureDarwin.screenshot", () => {
  it.effect("gives up on a one-shot helper that hangs, and kills it", () =>
    Effect.gen(function* () {
      const dir = yield* FakeDir;
      const taking = yield* Effect.forkChild((yield* ScreenCapture).screenshot(`${dir}/shot.png`));
      const pid = yield* fakePid;
      assert.isTrue(yield* running(pid));
      yield* TestClock.adjust(screenshotTimeout);
      const failure = yield* Effect.flip(Fiber.join(taking));
      assert.strictEqual(failure._tag, "ScreenCaptureFailed");
      assert.isFalse(yield* running(pid));
    }).pipe(Effect.provide(fakeHelper(":"))),
  );

  it.effect("is taken by the running session's helper", () =>
    Effect.gen(function* () {
      const dir = yield* FakeDir;
      const session = yield* (yield* SessionCapture).start(dir, "manual");
      yield* (yield* ScreenCapture).screenshot(`${dir}/a shot.png`);
      yield* session.stop;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        fakeHelper('[ "$cmd" = screenshot ] && echo "screenshot-saved $rest" || true'),
      ),
    ),
  );

  it.effect("fails when the session's helper never answers", () =>
    Effect.gen(function* () {
      const dir = yield* FakeDir;
      const session = yield* (yield* SessionCapture).start(dir, "manual");
      const taking = yield* Effect.forkChild((yield* ScreenCapture).screenshot(`${dir}/shot.png`));
      // Lets it send the command and start its timer.
      yield* Effect.yieldNow;
      yield* TestClock.adjust(screenshotTimeout);
      const failure = yield* Effect.flip(Fiber.join(taking));
      assert.strictEqual(failure._tag, "ScreenCaptureFailed");
      yield* session.stop;
    }).pipe(Effect.scoped, Effect.provide(fakeHelper(":"))),
  );

  it.effect("fails when the session's helper could not take it", () =>
    Effect.gen(function* () {
      const dir = yield* FakeDir;
      const session = yield* (yield* SessionCapture).start(dir, "manual");
      const failure = yield* Effect.flip((yield* ScreenCapture).screenshot(`${dir}/shot.png`));
      assert.strictEqual(failure._tag, "ScreenCaptureFailed");
      yield* session.stop;
    }).pipe(
      Effect.scoped,
      Effect.provide(
        fakeHelper('[ "$cmd" = screenshot ] && echo "screenshot-failed $rest" || true'),
      ),
    ),
  );
});

describe("SessionCaptureDarwin clips", () => {
  it.effect("give up on a session helper that stops answering, so the session can stop", () =>
    Effect.gen(function* () {
      const dir = yield* FakeDir;
      const session = yield* (yield* SessionCapture).start(dir, "manual");
      const starting = yield* Effect.forkChild(
        Effect.scoped((yield* ClipCapture).start(`${dir}/clip`)),
      );
      // Lets it send the command and start its timer, then lets the stop it sends time out too.
      yield* Effect.yieldNow;
      yield* TestClock.adjust(clipAnswerTimeout);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(clipAnswerTimeout);
      const failure = yield* Effect.flip(Fiber.join(starting));
      assert.strictEqual(failure._tag, "ScreenCaptureFailed");
      // Its late answer could end the next clip, so none starts until the helper answers.
      const next = yield* Effect.flip(Effect.scoped((yield* ClipCapture).start(`${dir}/next`)));
      assert.deepStrictEqual(
        next,
        new ScreenCaptureFailed({ reason: "the last clip has not finished" }),
      );
      yield* session.stop;
    }).pipe(Effect.scoped, Effect.provide(fakeHelper(":"))),
  );
});
