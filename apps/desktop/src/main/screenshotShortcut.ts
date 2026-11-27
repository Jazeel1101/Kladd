import { OverlayWindows, Screenshots } from "@kladd/core";
import { Effect, Layer } from "effect";
import { captureErrorMessage, registerShortcut } from "./globalShortcut";

/** ⌃⇧C anywhere during a session: screenshot the whole screen into it and fly it into the pill. */
export const ScreenshotShortcutLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const screenshots = yield* Screenshots;
    const windows = yield* OverlayWindows;
    // Loaded now, so the first screenshot doesn't wait for the flight window's UI.
    yield* Effect.forkScoped(windows.prepare("flight"));
    yield* registerShortcut(
      "Control+Shift+C",
      screenshots.take,
      (error) => captureErrorMessage(error._tag, "take the screenshot"),
      "screenshots",
    );
  }),
);
