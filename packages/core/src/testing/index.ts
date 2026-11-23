/**
 * Test doubles for every port in ../ports. Use these instead of writing mocks in a test.
 * Adding a port? Add its test layer here in the same PR.
 */
import {
  RecordingSessionId,
  ScreenCapturePermissionDenied,
  emptyFocus,
  makeAppAdapter,
  type AppAdapter,
  type FocusSnapshot,
  type Rect,
  type RecordingSession,
  type WindowKind,
} from "@kladd/domain";
import { Context, Effect, Layer, Option, Ref } from "effect";
import { AppAdapters } from "../ports/AppAdapters";
import { FocusTracker } from "../ports/FocusTracker";
import { Ids } from "../ports/Ids";
import { OverlayWindows } from "../ports/OverlayWindows";
import { RecordingStore } from "../ports/RecordingStore";
import { ScreenCapture } from "../ports/ScreenCapture";

export const ScreenCaptureTest = {
  granted: Layer.succeed(
    ScreenCapture,
    ScreenCapture.of({ start: Effect.void, stop: Effect.void }),
  ),
  denied: Layer.succeed(
    ScreenCapture,
    ScreenCapture.of({
      start: Effect.fail(new ScreenCapturePermissionDenied({})),
      stop: Effect.void,
    }),
  ),
};

/** In-memory store. Starts empty. */
export const RecordingStoreTest = Layer.effect(
  RecordingStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(Option.none<RecordingSession>());
    return RecordingStore.of({
      active: Ref.get(ref),
      save: (session) => Ref.set(ref, Option.some(session)),
      clear: Ref.set(ref, Option.none()),
    });
  }),
);

/** Returns "session-1", "session-2", ... */
export const IdsTest = Layer.effect(
  Ids,
  Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    return Ids.of({
      recordingSessionId: Ref.updateAndGet(counter, (n) => n + 1).pipe(
        Effect.map((n) => RecordingSessionId.make(`session-${n}`)),
      ),
    });
  }),
);

/** Always reports `snapshot` (default: nothing known, as without Accessibility permission). */
export const FocusTrackerTest = (snapshot: FocusSnapshot = emptyFocus) =>
  Layer.succeed(FocusTracker, FocusTracker.of({ current: Effect.succeed(snapshot) }));

/** The registered adapters: none by default, with a fallback that anchors to the caret. */
export const AppAdaptersTest = (all: ReadonlyArray<AppAdapter> = []) =>
  Layer.succeed(
    AppAdapters,
    AppAdapters.of({
      all,
      fallback: makeAppAdapter({ id: "test-fallback", bundleIds: [], anchor: (f) => f.caret }),
    }),
  );

/** What OverlayWindowsTest saw. Read it with `yield* OverlayWindowsLog` in a test. */
export class OverlayWindowsLog extends Context.Service<
  OverlayWindowsLog,
  Ref.Ref<ReadonlyArray<{ readonly kind: WindowKind; readonly bounds: Rect | undefined }>>
>()("kladd/core/testing/OverlayWindowsLog") {}

/** Records every `show` in OverlayWindowsLog. Every window is 300x400 on a 1440x900 screen. */
export const OverlayWindowsTest = Layer.unwrap(
  Effect.gen(function* () {
    const log = yield* Ref.make<
      ReadonlyArray<{ readonly kind: WindowKind; readonly bounds: Rect | undefined }>
    >([]);
    const windows = OverlayWindows.of({
      show: (kind, bounds) => Ref.update(log, (shown) => [...shown, { kind, bounds }]),
      hide: () => Effect.void,
      size: () => ({ width: 300, height: 400 }),
      workArea: () => Effect.succeed({ x: 0, y: 0, width: 1440, height: 900 }),
    });
    return Layer.mergeAll(
      Layer.succeed(OverlayWindows, windows),
      Layer.succeed(OverlayWindowsLog, log),
    );
  }),
);
