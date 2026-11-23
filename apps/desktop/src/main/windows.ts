import { OverlayWindows } from "@kladd/core";
import { placeWithoutAnchor, type Rect, type Size, type WindowKind } from "@kladd/domain";
import { BrowserWindow, app, screen } from "electron";
import { Deferred, Effect, Layer, Schedule } from "effect";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Set by scripts/dev.ts. Unset in production, where the built UI is loaded from disk. */
const devServerUrl = process.env["KLADD_UI_URL"];

const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

const uiIndexPath = app.isPackaged
  ? join(app.getAppPath(), "ui", "index.html")
  : join(app.getAppPath(), "..", "ui", "dist", "index.html");

/** True when a renderer URL is our UI. Used to reject RPC connections from anything else. */
export const isAppUrl = (url: string): boolean =>
  devServerUrl !== undefined ? url.startsWith(devServerUrl) : url.startsWith("file://");

interface WindowSpec {
  readonly size: Size;
  /** Overlays float over other apps and never take focus when shown. Settings is the only non-overlay. */
  readonly overlay: boolean;
  /** Where the window opens when the caller gives no bounds. */
  readonly position: (size: Size, workArea: Rect) => { x: number; y: number };
}

/**
 * Every window Kladd has. Adding one starts with a WindowKind in packages/domain/src/Window.ts.
 */
const windowTable: Record<WindowKind, WindowSpec> = {
  pill: {
    size: { width: 132, height: 36 },
    overlay: true,
    // Left screen edge, four fifths down.
    position: (size, area) => ({
      x: area.x + 8,
      y: Math.round(area.y + area.height * 0.8 - size.height / 2),
    }),
  },
  logging: {
    size: { width: 360, height: 480 },
    overlay: true,
    // Normally placed by core's LoggingOverlay; this is only the fallback.
    position: placeWithoutAnchor,
  },
  expanded: {
    size: { width: 720, height: 560 },
    overlay: true,
    position: centred,
  },
  settings: {
    size: { width: 640, height: 480 },
    overlay: false,
    position: centred,
  },
};

function centred(size: Size, area: Rect) {
  return {
    x: area.x + Math.round((area.width - size.width) / 2),
    y: area.y + Math.round((area.height - size.height) / 2),
  };
}

const workArea = (near: Rect | null): Rect =>
  near === null ? screen.getPrimaryDisplay().workArea : screen.getDisplayMatching(near).workArea;

const overlayOptions = {
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  hasShadow: true,
  // A non-activating panel: clicks reach it without stealing key focus from the writing app.
  type: "panel",
} satisfies Electron.BrowserWindowConstructorOptions;

const createWindow = (spec: WindowSpec) => {
  const window = new BrowserWindow({
    ...(spec.overlay ? overlayOptions : { title: "Kladd" }),
    ...spec.size,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (spec.overlay) {
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  return window;
};

/** The UI renders the window named by the hash (apps/ui/src/main.tsx). */
const loadWindow = (window: BrowserWindow, kind: WindowKind) =>
  devServerUrl !== undefined
    ? Effect.tryPromise(() => window.loadURL(`${devServerUrl}#${kind}`)).pipe(
        // The Vite dev server may still be starting.
        Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 40 }),
      )
    : Effect.tryPromise(() => window.loadFile(uiIndexPath, { hash: kind }));

/** OverlayWindows port: creates each window on first use and reuses it after that. */
export const OverlayWindowsLive = Layer.effect(
  OverlayWindows,
  Effect.gen(function* () {
    // Each window with its load. Both are stored before anything yields, so concurrent callers share
    // one window, and the load runs in the layer's scope, so a cancelled caller can't abandon it.
    const open = new Map<
      WindowKind,
      { readonly window: BrowserWindow; readonly loaded: Deferred.Deferred<void> }
    >();
    const scope = yield* Effect.scope;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => open.forEach(({ window }) => window.isDestroyed() || window.destroy())),
    );

    const get = Effect.fn("OverlayWindows.get")(function* (kind: WindowKind) {
      let entry = open.get(kind);
      if (entry === undefined || entry.window.isDestroyed()) {
        const created = {
          window: createWindow(windowTable[kind]),
          loaded: Deferred.makeUnsafe<void>(),
        };
        open.set(kind, created);
        yield* loadWindow(created.window, kind).pipe(
          Effect.orDie,
          // A window that failed to load is dropped, so the next show creates it again.
          Effect.tapCause(() =>
            Effect.sync(() => {
              if (open.get(kind) === created) open.delete(kind);
              if (!created.window.isDestroyed()) created.window.destroy();
            }),
          ),
          Deferred.into(created.loaded),
          Effect.forkIn(scope),
        );
        entry = created;
      }
      yield* Deferred.await(entry.loaded);
      return entry.window;
    });

    const show = Effect.fn("OverlayWindows.show")(function* (kind: WindowKind, bounds?: Rect) {
      const spec = windowTable[kind];
      const window = yield* get(kind);
      const area = workArea(bounds ?? null);
      const target = bounds ?? { ...spec.size, ...spec.position(spec.size, area) };
      // Animate only moves of a window that is already on screen.
      window.setBounds(target, window.isVisible());
      if (spec.overlay) {
        window.showInactive();
      } else {
        window.show();
        window.focus();
      }
    });

    const hide = (kind: WindowKind) =>
      Effect.sync(() => {
        const window = open.get(kind)?.window;
        if (window !== undefined && !window.isDestroyed()) window.hide();
      }).pipe(Effect.withSpan("OverlayWindows.hide"));

    return OverlayWindows.of({
      show,
      hide,
      size: (kind) => windowTable[kind].size,
      workArea: (near) => Effect.sync(() => workArea(near)),
    });
  }),
);

/** Kladd's presence: the pill is shown at startup and stays. */
export const PillLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const windows = yield* OverlayWindows;
    yield* windows.show("pill");
  }),
);
