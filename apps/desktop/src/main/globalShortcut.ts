import { dialog, globalShortcut } from "electron";
import { Effect, type Scope } from "effect";

/** The dialog for a failed shortcut action, by error tag. */
export const captureErrorMessage = (
  tag: "ScreenCapturePermissionDenied" | "ScreenCaptureFailed",
  failed: string,
): string => {
  switch (tag) {
    case "ScreenCapturePermissionDenied":
      return "Kladd needs screen recording permission (System Settings → Privacy & Security).";
    case "ScreenCaptureFailed":
      return `Kladd could not ${failed}. Try again, or restart Kladd.`;
  }
};

/**
 * Runs `action` whenever `accelerator` is pressed in any app, for as long as the scope is open,
 * and shows its failure as `message(error)`. Logs a warning, naming `what` goes off, when another
 * app already has the shortcut.
 */
export const registerShortcut = Effect.fn("registerShortcut")(function* <
  E extends { readonly _tag: string },
>(
  accelerator: string,
  action: Effect.Effect<unknown, E>,
  message: (error: E) => string,
  what: string,
): Effect.fn.Return<void, never, Scope.Scope> {
  const context = yield* Effect.context<never>();
  const run = action.pipe(
    Effect.asVoid,
    Effect.catch((error) => Effect.sync(() => dialog.showErrorBox("Kladd", message(error)))),
  );
  const registered = yield* Effect.acquireRelease(
    Effect.sync(() => globalShortcut.register(accelerator, () => Effect.runForkWith(context)(run))),
    () => Effect.sync(() => globalShortcut.unregister(accelerator)),
  );
  if (!registered)
    yield* Effect.logWarning(`${accelerator} is taken by another app; ${what} are off`);
});
