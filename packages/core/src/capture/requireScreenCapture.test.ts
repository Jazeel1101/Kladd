import { assert, describe, it } from "@effect/vitest";
import { Effect, type Layer } from "effect";
import type { ScreenCapture } from "../ports/ScreenCapture";
import { ScreenCaptureTest } from "../testing";
import { requireScreenCapture } from "./requireScreenCapture";

const run = (capture: Layer.Layer<ScreenCapture>) =>
  requireScreenCapture.pipe(Effect.result, Effect.provide(capture));

describe("requireScreenCapture", () => {
  it.effect("succeeds without asking when permission is granted", () =>
    Effect.gen(function* () {
      const result = yield* run(ScreenCaptureTest.grantedRevokedOnRequest);
      assert.strictEqual(result._tag, "Success");
    }),
  );

  it.effect("asks when permission is missing and succeeds once the user grants it", () =>
    Effect.gen(function* () {
      const result = yield* run(ScreenCaptureTest.grantedOnRequest);
      assert.strictEqual(result._tag, "Success");
    }),
  );

  it.effect("fails with ScreenCapturePermissionDenied when the user does not grant it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        requireScreenCapture.pipe(Effect.provide(ScreenCaptureTest.denied)),
      );
      assert.strictEqual(error._tag, "ScreenCapturePermissionDenied");
    }),
  );
});
