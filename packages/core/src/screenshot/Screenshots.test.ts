import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";
import { type FocusSnapshot, type ScreenshotId, SessionId, emptyFocus } from "@kladd/domain";
import type { ScreenCapture } from "../ports/ScreenCapture";
import { SessionStore } from "../ports/SessionStore";
import {
  FocusTrackerTest,
  IdsTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
  ScreenCaptureTest,
  SessionStoreTest,
} from "../testing";
import { Screenshots } from "./Screenshots";

const session = SessionId.make("session-1");
const folder = "/sessions/session-1";

const kladd = (
  capture: Layer.Layer<ScreenCapture> = ScreenCaptureTest.granted,
  focus: FocusSnapshot = emptyFocus,
) =>
  Screenshots.layer.pipe(
    Layer.provide([capture, IdsTest, FocusTrackerTest(focus)]),
    Layer.provideMerge(Layer.mergeAll(OverlayWindowsTest, SessionStoreTest())),
  );

/** Runs `test` inside a session, the only time screenshots are taken. */
const withCapture =
  (capture?: Layer.Layer<ScreenCapture>, focus?: FocusSnapshot) =>
  <A, E, R>(test: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      yield* (yield* Screenshots).begin(session, folder);
      return yield* test;
    }).pipe(Effect.provide(kladd(capture, focus)));

/** The tray now. */
const tray = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  return Option.getOrUndefined(yield* Stream.runHead(screenshots.changes));
});

/** The screenshot taken last: flying, or attached. */
const newest = Effect.gen(function* () {
  const now = yield* tray;
  const shot = now?.flying?.screenshot ?? now?.attached[0];
  assert.isDefined(shot);
  return shot;
});

const shownWindows = Effect.gen(function* () {
  return (yield* Ref.get(yield* OverlayWindowsLog)).map((shown) => shown.kind);
});

const display = { x: 0, y: 0, width: 1440, height: 900 };
/** The slot of a pill docked on the left wall, as the pill reports it. */
const slot = { room: { x: 46, y: 608, width: 252, height: 114 }, hug: "left" as const };

/** Takes a screenshot once the pill has reported its slot. */
const takeAimed = Effect.gen(function* () {
  const screenshots = yield* Screenshots;
  yield* screenshots.aimAt(slot);
  yield* screenshots.take;
  return yield* newest;
});

/** Lands a screenshot, waiting out the moment main gives the pill to draw it. */
const land = Effect.fn("test.land")(function* (id: ScreenshotId) {
  const screenshots = yield* Screenshots;
  const landing = yield* Effect.forkChild(screenshots.land(id));
  yield* TestClock.adjust("1 second");
  yield* Fiber.join(landing);
});

describe("Screenshots.take", () => {
  it.effect("flies the screenshot from the whole display into the pill's slot", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.deepStrictEqual((yield* tray)?.flying, {
        screenshot,
        from: display,
        to: { x: 46, y: 608, width: 182, height: 114 },
      });
      assert.deepStrictEqual(screenshot.display, display);
      // Only the flight window: the logging overlay stays as it was.
      assert.deepStrictEqual(yield* Ref.get(yield* OverlayWindowsLog), [
        { kind: "flight", bounds: display },
      ]);
    }).pipe(withCapture()),
  );

  it.effect("attaches the screenshot at once while the pill hasn't said where it is", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      yield* screenshots.take;
      const screenshot = yield* newest;
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [screenshot] });
      assert.deepStrictEqual(yield* shownWindows, []);
    }).pipe(withCapture()),
  );

  it.effect("lands a screenshot still flying, so only one flies at a time", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      const second = yield* takeAimed;
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.deepStrictEqual(
        now?.attached.map((s) => s.id),
        [first.id],
      );
    }).pipe(withCapture()),
  );

  it.effect("asks for permission, and takes nothing when it is denied", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(takeAimed);
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [] });
      assert.deepStrictEqual(yield* shownWindows, []);
    }).pipe(withCapture(ScreenCaptureTest.denied)),
  );

  it.effect("takes the screenshot once the user grants permission", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.strictEqual((yield* tray)?.flying?.screenshot.id, screenshot.id);
    }).pipe(withCapture(ScreenCaptureTest.grantedOnRequest)),
  );

  it.effect("does nothing outside a session", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      yield* screenshots.aimAt(slot);
      yield* screenshots.take;
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [] });
      assert.deepStrictEqual(yield* shownWindows, []);
    }).pipe(Effect.provide(kladd())),
  );

  it.effect("saves it in the session folder with where the student was", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      assert.strictEqual(screenshot.session, session);
      const [saved] = yield* (yield* SessionStore).screenshots(folder);
      assert.strictEqual(saved?.id, screenshot.id);
      assert.strictEqual(saved?.focus?.app?.name, "Microsoft OneNote");
      assert.strictEqual(saved?.focus?.title, "2IT Notatblokk");
    }).pipe(
      withCapture(undefined, {
        ...emptyFocus,
        app: { bundleId: "com.microsoft.onenote.mac", name: "Microsoft OneNote" },
        title: "2IT Notatblokk",
      }),
    ),
  );

  it.effect("keeps an excluded app's window title out of the session folder", () =>
    Effect.gen(function* () {
      yield* takeAimed;
      const [saved] = yield* (yield* SessionStore).screenshots(folder);
      assert.strictEqual(saved?.focus?.app?.name, "Messages");
      assert.isNull(saved?.focus?.title);
    }).pipe(
      withCapture(undefined, {
        ...emptyFocus,
        app: { bundleId: "com.apple.MobileSMS", name: "Messages" },
        title: "A private conversation",
      }),
    ),
  );
});

describe("Screenshots.begin, end and clear", () => {
  it.effect("the tray shows the session's screenshots, newest first, until it is cleared", () =>
    Effect.gen(function* () {
      const screenshots = yield* Screenshots;
      yield* screenshots.take;
      yield* screenshots.take;
      // Kladd restarted: the session's screenshots come back from its folder.
      yield* screenshots.clear;
      yield* screenshots.begin(session, folder);
      const ids = (yield* tray)?.attached.map((s) => s.id);
      assert.deepStrictEqual(ids, [
        "00000000-0000-7000-8000-000000000002",
        "00000000-0000-7000-8000-000000000001",
      ]);
      yield* screenshots.end;
      yield* screenshots.take;
      assert.strictEqual((yield* tray)?.attached.length, 2);
      yield* screenshots.clear;
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [] });
    }).pipe(withCapture()),
  );
});

describe("Screenshots.land", () => {
  it.effect("attaches the screenshot in flight and hides the flight window", () =>
    Effect.gen(function* () {
      const screenshot = yield* takeAimed;
      yield* land(screenshot.id);
      assert.deepStrictEqual(yield* tray, { flying: null, attached: [screenshot] });
      assert.deepStrictEqual(yield* Ref.get(yield* OverlayWindowsLog), [
        { kind: "flight", bounds: display },
        { kind: "flight", bounds: undefined, hidden: true },
      ]);
    }).pipe(withCapture()),
  );

  it.effect("moves the screenshot in flight to the front of the attached ones", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      yield* land(first.id);
      const second = yield* takeAimed;
      yield* land(second.id);
      const now = yield* tray;
      assert.isNull(now?.flying);
      assert.deepStrictEqual(
        now?.attached.map((s) => s.id),
        [second.id, first.id],
      );
    }).pipe(withCapture()),
  );

  it.effect("ignores an older flight, and leaves the window to the newer one", () =>
    Effect.gen(function* () {
      const first = yield* takeAimed;
      const second = yield* takeAimed;
      // The first flight finishes after the second has started.
      yield* land(first.id);
      const now = yield* tray;
      assert.strictEqual(now?.flying?.screenshot.id, second.id);
      assert.strictEqual(now?.attached.length, 1);
      assert.deepStrictEqual(yield* shownWindows, ["flight", "flight"]);
    }).pipe(withCapture()),
  );
});
