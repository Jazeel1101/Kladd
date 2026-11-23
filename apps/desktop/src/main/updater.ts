import { app } from "electron";
import electronUpdater from "electron-updater";
import { Effect, Layer } from "effect";

/** Checks GitHub Releases for a newer version (publish config: electron-builder.yml). */
export const UpdaterLive = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!app.isPackaged) return yield* Effect.logDebug("Updater: skipped, app is not packaged");
    yield* Effect.tryPromise(() => electronUpdater.autoUpdater.checkForUpdatesAndNotify()).pipe(
      Effect.ignoreCause({ log: "Warn", message: "Update check failed" }),
      Effect.forkScoped,
    );
  }),
);
