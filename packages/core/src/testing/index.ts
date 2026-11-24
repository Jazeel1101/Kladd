/**
 * Test doubles for every port in ../ports. Use these instead of writing mocks in a test.
 * Adding a port? Add its test layer here in the same PR.
 */
import {
  type AccessibilityPermission,
  FocusTrackingFailed,
  RecordingSessionId,
  ScreenCapturePermissionDenied,
  type ScreenCapturePermission,
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

const screenCaptureTest = (
  permission: ScreenCapturePermission,
  afterRequest: ScreenCapturePermission,
  /** Runs before every permission check: Effect.yieldNow lets concurrent calls interleave. */
  pause: Effect.Effect<void> = Effect.void,
) =>
  Layer.effect(
    ScreenCapture,
    Effect.gen(function* () {
      const current = yield* Ref.make(permission);
      const capture = Effect.flatMap(Ref.get(current), (now) =>
        now === "granted" ? Effect.void : Effect.fail(new ScreenCapturePermissionDenied({})),
      );
      return ScreenCapture.of({
        permission: Effect.andThen(pause, Ref.get(current)),
        requestPermission: Ref.set(current, afterRequest).pipe(Effect.as(afterRequest)),
        screenshot: () => capture,
        recordVideo: () => Effect.as(capture, { stop: Effect.void }),
      });
    }),
  );

/** Screenshots and video succeed only while permission is granted. */
export const ScreenCaptureTest = {
  granted: screenCaptureTest("granted", "granted"),
  /** Like granted, but the permission check yields first, so concurrent calls interleave. */
  slow: screenCaptureTest("granted", "granted", Effect.yieldNow),
  /** Denied, and the user does not grant it when asked. */
  denied: screenCaptureTest("denied", "denied"),
  /** Denied until asked; the user grants it. */
  grantedOnRequest: screenCaptureTest("denied", "granted"),
  /** Granted, but asking again would revoke it: shows that a granted permission is not requested. */
  grantedRevokedOnRequest: screenCaptureTest("granted", "denied"),
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

/** What FocusTrackerTest saw. Read it with `yield* FocusTrackerLog` in a test. */
export class FocusTrackerLog extends Context.Service<
  FocusTrackerLog,
  Ref.Ref<{ readonly permissionRequests: number }>
>()("kladd/core/testing/FocusTrackerLog") {}

/**
 * Always reports `snapshot` (default: nothing known, as without Accessibility permission).
 * `permission` is what it reports before and after a request; counts requests in FocusTrackerLog.
 * Given a FocusTrackingFailed, every call fails with it. Given an Effect, `current` runs it.
 */
export const FocusTrackerTest = (
  snapshot: FocusSnapshot | FocusTrackingFailed | Effect.Effect<FocusSnapshot> = emptyFocus,
  permission: {
    readonly before: AccessibilityPermission;
    readonly after: AccessibilityPermission;
    /** Runs before a request answers: Effect.never for a user who leaves the prompt open. */
    readonly answer?: Effect.Effect<void>;
  } = { before: "granted", after: "granted" },
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const log = yield* Ref.make({ permissionRequests: 0 });
      const current = yield* Ref.make(permission.before);
      const failed = snapshot instanceof FocusTrackingFailed ? snapshot : null;
      const orFail = <A>(effect: Effect.Effect<A>) =>
        failed === null ? effect : Effect.andThen(effect, Effect.fail(failed));
      const tracker = FocusTracker.of({
        current: Effect.isEffect(snapshot)
          ? snapshot
          : snapshot instanceof FocusTrackingFailed
            ? Effect.fail(snapshot)
            : Effect.succeed(snapshot),
        permission: orFail(Ref.get(current)),
        requestPermission: orFail(
          Ref.update(log, (l) => ({ permissionRequests: l.permissionRequests + 1 })).pipe(
            Effect.andThen(permission.answer ?? Effect.void),
            Effect.andThen(Ref.set(current, permission.after)),
            Effect.as(permission.after),
          ),
        ),
      });
      return Layer.mergeAll(
        Layer.succeed(FocusTracker, tracker),
        Layer.succeed(FocusTrackerLog, log),
      );
    }),
  );

/** The registered adapters: none by default, with a fallback that anchors to the caret. */
export const AppAdaptersTest = (all: ReadonlyArray<AppAdapter> = []) =>
  Layer.succeed(
    AppAdapters,
    AppAdapters.of({
      all,
      fallback: makeAppAdapter({ id: "test-fallback", bundleIds: [], anchor: (f) => f.caret }),
    }),
  );

interface ShownWindow {
  readonly kind: WindowKind;
  readonly bounds: Rect | undefined;
}

/** What OverlayWindowsTest saw. Read it with `yield* OverlayWindowsLog` in a test. */
export class OverlayWindowsLog extends Context.Service<
  OverlayWindowsLog,
  Ref.Ref<ReadonlyArray<ShownWindow>>
>()("kladd/core/testing/OverlayWindowsLog") {}

/** Records every `show` in OverlayWindowsLog. Every window is 300x400 on a 1440x900 screen. */
export const OverlayWindowsTest = Layer.unwrap(
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<ShownWindow>>([]);
    const windows = OverlayWindows.of({
      show: (kind, bounds) => Ref.update(log, (shown) => [...shown, { kind, bounds }]),
      hide: () => Effect.void,
      prepare: () => Effect.void,
      moveTo: () => Effect.void,
      setClickThrough: () => Effect.void,
      size: () => ({ width: 300, height: 400 }),
      workArea: () => Effect.succeed({ x: 0, y: 0, width: 1440, height: 900 }),
    });
    return Layer.mergeAll(
      Layer.succeed(OverlayWindows, windows),
      Layer.succeed(OverlayWindowsLog, log),
    );
  }),
);
