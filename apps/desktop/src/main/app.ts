import { app } from "electron";
import { Effect, Layer } from "effect";

/** Waits for Electron to be ready and applies app-wide rules. Window layers depend on this. */
export const ElectronAppLive = Layer.effectDiscard(
  Effect.gen(function* () {
    app.on("window-all-closed", () => app.quit());
    app.on("web-contents-created", (_event, contents) => {
      // Windows only show our own UI: no navigation away, no popups.
      contents.on("will-navigate", (navigation) => navigation.preventDefault());
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
    yield* Effect.promise(() => app.whenReady());
  }),
);
