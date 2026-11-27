import { assert, describe, it } from "@effect/vitest";
import {
  FocusTrackingFailed,
  emptyFocus,
  makeAppAdapter,
  overlayMargin,
  type FocusSnapshot,
  type PillDock,
} from "@kladd/domain";
import { Deferred, Effect, Fiber, Layer, Queue, Ref, Stream } from "effect";
import {
  AppAdaptersTest,
  FocusTrackerTest,
  OverlayWindowsLog,
  OverlayWindowsTest,
} from "../testing";
import { LoggingOverlay } from "./LoggingOverlay";

const notesWithPage = makeAppAdapter({
  id: "notes-pages",
  bundleIds: ["com.apple.Notes"],
  target: (f) => ({ app: "Notes", document: f.title?.replace(" – Notes", "") ?? null }),
});
const app = { bundleId: "com.apple.Notes", name: "Notes" };
const page = (title: string): FocusSnapshot => ({ ...emptyFocus, app, title });

/** A column notch docked on the left wall of the test's 1440x900 screen, its middle at y = 465. */
const leftDock: PillDock = { notch: { x: 0, y: 400, width: 46, height: 130 }, wall: "left" };

const provide = (
  focus: FocusSnapshot | FocusTrackingFailed | Effect.Effect<FocusSnapshot> = page("Uke 1 – Notes"),
  changes?: Stream.Stream<FocusSnapshot, FocusTrackingFailed>,
) =>
  Effect.provide(
    LoggingOverlay.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          FocusTrackerTest(focus, undefined, changes),
          AppAdaptersTest([notesWithPage]),
          OverlayWindowsTest,
        ),
      ),
    ),
  );

const shown = Effect.gen(function* () {
  return yield* Ref.get(yield* OverlayWindowsLog);
});

const now = Effect.gen(function* () {
  return yield* Stream.runHead((yield* LoggingOverlay).changes).pipe(
    Effect.map((head) => (head._tag === "Some" ? head.value : null)),
  );
});

describe("LoggingOverlay.open", () => {
  it.effect("grows out of the pill where it rests, centred on the notch", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      yield* overlay.pillAt(leftDock);
      yield* overlay.open;
      assert.deepStrictEqual(yield* shown, [
        {
          kind: "logging",
          bounds: { x: 46 - overlayMargin, y: 265, width: 300, height: 400 },
        },
      ]);
      assert.deepStrictEqual(yield* now, {
        open: true,
        panel: "summary",
        target: { app: "Notes", document: "Uke 1" },
        join: { side: "left", start: 135, end: 265 },
      });
    }).pipe(provide()),
  );

  it.effect("opens at the screen's right edge, unjoined, before the pill has rested", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      yield* overlay.open;
      assert.deepStrictEqual((yield* shown)[0]?.bounds, {
        x: 1132,
        y: 250,
        width: 300,
        height: 400,
      });
      assert.isNull((yield* now)?.join);
    }).pipe(provide()),
  );

  it.effect("opens with no writing target when focus can't be read", () =>
    Effect.gen(function* () {
      yield* (yield* LoggingOverlay).open;
      assert.deepStrictEqual((yield* now)?.target, { app: null, document: null });
    }).pipe(provide(new FocusTrackingFailed({ reason: "no helper" }))),
  );

  it.effect("a slow open can't overwrite a newer one", () =>
    Effect.gen(function* () {
      const firstAnswers = yield* Deferred.make<void>();
      const calls = yield* Ref.make(0);
      // The first focus read answers only after the second open has started.
      const current = Ref.getAndUpdate(calls, (n) => n + 1).pipe(
        Effect.flatMap((n) =>
          n === 0
            ? Effect.as(Deferred.await(firstAnswers), page("Uke 1 – Notes"))
            : Effect.succeed(page("Uke 2 – Notes")),
        ),
      );
      const target = yield* Effect.gen(function* () {
        const overlay = yield* LoggingOverlay;
        const slow = yield* Effect.forkChild(overlay.open);
        yield* Effect.yieldNow;
        const fast = yield* Effect.forkChild(overlay.open);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(firstAnswers, undefined);
        yield* Fiber.join(slow);
        yield* Fiber.join(fast);
        return (yield* now)?.target.document;
      }).pipe(provide(current));
      assert.strictEqual(target, "Uke 2");
    }),
  );
});

describe("the pill's buttons", () => {
  it.effect("the star opens the overlay on its summary, and closes it", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      yield* overlay.toggle;
      assert.deepStrictEqual([(yield* now)?.open, (yield* now)?.panel], [true, "summary"]);
      yield* overlay.toggle;
      assert.isFalse((yield* now)?.open);
      assert.deepStrictEqual(
        (yield* shown).map((s) => (s.hidden ? `-${s.kind}` : s.kind)),
        ["logging", "-logging"],
      );
    }).pipe(provide()),
  );

  it.effect(
    "the star switches the overlay back to its summary from the settings, without closing",
    () =>
      Effect.gen(function* () {
        const overlay = yield* LoggingOverlay;
        yield* overlay.toggleSettings;
        yield* overlay.toggle;
        assert.deepStrictEqual([(yield* now)?.open, (yield* now)?.panel], [true, "summary"]);
        assert.isTrue((yield* shown).every((s) => s.hidden !== true));
      }).pipe(provide()),
  );

  it.effect("the gear opens the overlay on settings, then swaps settings and summary", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      const panels: Array<string | undefined> = [];
      for (let i = 0; i < 3; i++) {
        yield* overlay.toggleSettings;
        panels.push((yield* now)?.panel);
      }
      assert.deepStrictEqual(panels, ["settings", "summary", "settings"]);
      assert.strictEqual((yield* shown).length, 1, "swapping panels doesn't show it again");
    }).pipe(provide()),
  );
});

describe("LoggingOverlay.pillAt", () => {
  it.effect("moves the open overlay with the pill, without its neck while the pill moves", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      yield* overlay.pillAt(leftDock);
      yield* overlay.open;
      yield* overlay.pillAt(null);
      assert.isNull((yield* now)?.join, "the pill is moving");
      const right: PillDock = { notch: { ...leftDock.notch, x: 1440 - 46 }, wall: "right" };
      yield* overlay.pillAt(right);
      const last = (yield* shown).at(-1);
      assert.deepStrictEqual(last, {
        kind: "logging",
        bounds: { x: 1440 - 46 - 300 + overlayMargin, y: 265, width: 300, height: 400 },
        moved: true,
      });
      assert.strictEqual((yield* now)?.join?.side, "right");
    }).pipe(provide()),
  );

  it.effect("a pill that moves while the overlay is closed only changes where it opens", () =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      yield* overlay.pillAt(leftDock);
      assert.deepStrictEqual(yield* shown, []);
      yield* overlay.open;
      assert.strictEqual((yield* shown)[0]?.bounds?.x, 46 - overlayMargin);
    }).pipe(provide()),
  );
});

describe("while open", () => {
  const other = { ...emptyFocus, app: { bundleId: "com.apple.Safari", name: "Safari" } };

  /** Opens the overlay with `changes` as the focus watch; returns the documents the UI is told. */
  const follow = (
    changes: Queue.Queue<FocusSnapshot>,
    steps: Effect.Effect<void, never, LoggingOverlay>,
  ) =>
    Effect.gen(function* () {
      const overlay = yield* LoggingOverlay;
      const seen = yield* Ref.make<ReadonlyArray<string | null>>([]);
      yield* overlay.changes.pipe(
        Stream.map((state) => state.target.document),
        Stream.changes,
        Stream.runForEach((document) => Ref.update(seen, (all) => [...all, document])),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* overlay.open;
      yield* steps;
      return yield* Ref.get(seen);
    }).pipe(provide(page("Uke 1 – Notes"), Stream.fromQueue(changes)));

  it.effect("follows the page the user switches to", () =>
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<FocusSnapshot>();
      const seen = yield* follow(
        changes,
        Effect.gen(function* () {
          yield* Queue.offerAll(changes, [page("Uke 1 – Notes"), page("Uke 2 – Notes")]);
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
        }),
      );
      assert.deepStrictEqual(seen, [null, "Uke 1", "Uke 2"]);
    }),
  );

  it.effect("ignores other apps", () =>
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<FocusSnapshot>();
      const seen = yield* follow(
        changes,
        Effect.gen(function* () {
          yield* Queue.offer(changes, other);
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
        }),
      );
      assert.deepStrictEqual(seen, [null, "Uke 1"]);
    }),
  );

  it.effect("stops following when closed", () =>
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<FocusSnapshot>();
      const seen = yield* follow(
        changes,
        Effect.gen(function* () {
          const overlay = yield* LoggingOverlay;
          yield* overlay.close;
          yield* Queue.offer(changes, page("Uke 2 – Notes"));
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
        }),
      );
      assert.deepStrictEqual(seen, [null, "Uke 1"]);
    }),
  );
});
