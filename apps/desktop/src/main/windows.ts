import { BrowserWindow, app } from "electron";
import { Effect, Layer, Schedule } from "effect";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Set by scripts/dev.ts. Unset in production, where the built UI is loaded from disk. */
const devServerUrl = process.env["KLADD_UI_URL"];

const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

const uiIndexPath = app.isPackaged
  ? join(app.getAppPath(), "ui", "index.html")
  : join(app.getAppPath(), "..", "ui", "dist", "index.html");

/** True when a renderer URL is our UI. Used to reject RPC connections from anything else. */
export const isAppUrl = (url: string): boolean =>
  devServerUrl !== undefined ? url.startsWith(devServerUrl) : url.startsWith("file://");

const createWindow = (options: Electron.BrowserWindowConstructorOptions) =>
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new BrowserWindow({
          ...options,
          webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
          },
        }),
    ),
    (window) => Effect.sync(() => window.isDestroyed() || window.destroy()),
  );

/** Every window is a UI route: "/" is the main window, overlays get "/overlay/...". */
const loadRoute = (window: BrowserWindow, route: string) =>
  devServerUrl !== undefined
    ? Effect.tryPromise(() => window.loadURL(`${devServerUrl}#${route}`)).pipe(
        // The Vite dev server may still be starting.
        Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 40 }),
      )
    : Effect.tryPromise(() => window.loadFile(uiIndexPath, { hash: route }));

export const MainWindowLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const window = yield* createWindow({ width: 960, height: 640, title: "Kladd" });
    yield* loadRoute(window, "/").pipe(Effect.orDie);
  }),
);
