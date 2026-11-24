import { app } from "electron";
import { Effect, Layer } from "effect";
import { registerScreenshotScheme } from "./screenshotProtocol";

/** Waits for Electron to be ready and applies app-wide rules. Window layers depend on this. */
export const ElectronAppLive = Layer.effectDiscard(
  Effect.gen(function* () {
    // The pill never closes, so closing Settings must not quit.
    app.on("window-all-closed", () => {});
    app.on("web-contents-created", (_event, contents) => {
      // Windows only show our own UI: no navigation away, no popups.
      contents.on("will-navigate", (navigation) => navigation.preventDefault());
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
    // Custom schemes must be registered before the app is ready.
    registerScreenshotScheme();
    yield* Effect.promise(() => app.whenReady());
    // Kladd is overlays only: the pill is its presence, so no Dock icon or app-switcher entry.
    app.dock?.hide();
  }),
);
