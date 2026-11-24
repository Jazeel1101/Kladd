import { Effect } from "effect";
import { FocusTracker } from "../ports/FocusTracker";

/**
 * Asks for Accessibility permission if Kladd lacks it. Never fails: without it the logging overlay
 * still opens, just at the no-anchor position.
 */
export const askForAccessibility = Effect.gen(function* () {
  const focus = yield* FocusTracker;
  if ((yield* focus.permission) === "granted") return;
  yield* focus.requestPermission;
}).pipe(
  Effect.catchTag("FocusTrackingFailed", (error) =>
    Effect.logWarning("Could not ask for Accessibility permission", error.reason),
  ),
  Effect.withSpan("askForAccessibility"),
);
