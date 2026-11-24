import { assert, describe, it } from "@effect/vitest";
import { FocusTrackingFailed, type AccessibilityPermission } from "@kladd/domain";
import { Effect, Ref } from "effect";
import { FocusTrackerLog, FocusTrackerTest } from "../testing";
import { askForAccessibility } from "./askForAccessibility";

const requestsWhen = (
  before: AccessibilityPermission,
  after: AccessibilityPermission,
  failed?: FocusTrackingFailed,
) =>
  Effect.gen(function* () {
    yield* askForAccessibility;
    return (yield* Ref.get(yield* FocusTrackerLog)).permissionRequests;
  }).pipe(Effect.provide(FocusTrackerTest(failed, { before, after })));

describe("askForAccessibility", () => {
  it.effect("does not ask when permission is granted", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* requestsWhen("granted", "denied"), 0);
    }),
  );

  it.effect("asks once when permission is missing", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* requestsWhen("denied", "granted"), 1);
    }),
  );

  it.effect("succeeds when the user does not grant it, or the tracker breaks", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* requestsWhen("denied", "denied"), 1);
      const broken = new FocusTrackingFailed({ reason: "no helper" });
      assert.strictEqual(yield* requestsWhen("denied", "denied", broken), 0);
    }),
  );
});
