import { ScreenCapturePermissionDenied } from "@kladd/domain";
import { Effect } from "effect";
import { ScreenCapture } from "../ports/ScreenCapture";

/** Succeeds when Kladd may capture the screen, asking the user first if it may not yet. */
export const requireScreenCapture = Effect.gen(function* () {
  const capture = yield* ScreenCapture;
  if ((yield* capture.permission) === "granted") return;
  if ((yield* capture.requestPermission) === "granted") return;
  return yield* new ScreenCapturePermissionDenied({});
}).pipe(Effect.withSpan("requireScreenCapture"));
