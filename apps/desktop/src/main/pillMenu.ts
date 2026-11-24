import { LoggingOverlay, OverlayWindows, Recordings } from "@kladd/core";
import { Menu, app, dialog } from "electron";
import { Context, Effect, Layer, Option } from "effect";

/** The pill's native menu: start/stop recording, show the logging overlay, Settings, Quit. */
export class PillMenu extends Context.Service<PillMenu, { readonly open: Effect.Effect<void> }>()(
  "kladd/desktop/PillMenu",
) {}

const startErrorMessage = (
  tag: "RecordingAlreadyActive" | "ScreenCapturePermissionDenied" | "ScreenCaptureFailed",
) => {
  switch (tag) {
    case "RecordingAlreadyActive":
      return "A recording is already running.";
    case "ScreenCapturePermissionDenied":
      return "Kladd needs screen recording permission (System Settings → Privacy & Security).";
    case "ScreenCaptureFailed":
      return "Kladd could not reach the screen. Try again, or restart Kladd.";
  }
};

export const PillMenuLive = Layer.effect(
  PillMenu,
  Effect.gen(function* () {
    const recordings = yield* Recordings;
    const windows = yield* OverlayWindows;
    const logging = yield* LoggingOverlay;
    const context = yield* Effect.context<never>();
    // Menu clicks are Electron callbacks, so each action is forked on the app's runtime.
    const run = (effect: Effect.Effect<void>) => () => Effect.runForkWith(context)(effect);

    const start = recordings.start.pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.sync(() => dialog.showErrorBox("Kladd", startErrorMessage(error._tag))),
      ),
    );
    // The menu only offers Stop while recording, so NoActiveRecording means a race: ignore it.
    const stop = recordings.stop.pipe(
      Effect.asVoid,
      Effect.catchTag("NoActiveRecording", () => Effect.void),
    );

    const open = Effect.gen(function* () {
      const recording = Option.isSome(yield* recordings.active);
      const menu = Menu.buildFromTemplate([
        recording
          ? { label: "Stop recording", click: run(stop) }
          : { label: "Start recording", click: run(start) },
        // Opens it without a recording: for trying app adapters in the app the user is in.
        { label: "Show logging overlay", click: run(logging.open) },
        { type: "separator" },
        { label: "Settings…", click: run(windows.show("settings")) },
        { label: "Quit Kladd", click: () => app.quit() },
      ]);
      menu.popup();
    }).pipe(Effect.withSpan("PillMenu.open"));

    return PillMenu.of({ open });
  }),
);
