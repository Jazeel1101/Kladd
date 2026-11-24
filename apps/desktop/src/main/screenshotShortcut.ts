import { OverlayWindows, Screenshots } from "@kladd/core";
import { dialog, globalShortcut } from "electron";
import { Effect, Layer } from "effect";

/** ⌃⇧C anywhere: screenshot the whole screen and fly it into the logging overlay. */
const accelerator = "Control+Shift+C";

const takeErrorMessage = (tag: "ScreenCapturePermissionDenied" | "ScreenCaptureFailed") => {
  switch (tag) {
    case "ScreenCapturePermissionDenied":
      return "Kladd needs screen recording permission (System Settings → Privacy & Security).";
    case "ScreenCaptureFailed":
      return "Kladd could not take the screenshot. Try again, or restart Kladd.";
  }
};

/** Registers the screenshot shortcut for as long as Kladd runs. */
export const ScreenshotShortcutLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const screenshots = yield* Screenshots;
    const windows = yield* OverlayWindows;
    const context = yield* Effect.context<never>();
    // Loaded now, so the first screenshot doesn't wait for the flight window's UI.
    yield* Effect.forkScoped(windows.prepare("flight"));

    const take = screenshots.take.pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.sync(() => dialog.showErrorBox("Kladd", takeErrorMessage(error._tag))),
      ),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        globalShortcut.register(accelerator, () => Effect.runForkWith(context)(take)),
      ),
      () => Effect.sync(() => globalShortcut.unregister(accelerator)),
    ).pipe(
      Effect.tap((registered) =>
        registered
          ? Effect.void
          : Effect.logWarning(`${accelerator} is taken by another app; screenshots are off`),
      ),
    );
  }),
);
