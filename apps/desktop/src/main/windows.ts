import { OverlayWindows } from "@kladd/core";
import {
  placeWithoutAnchor,
  type Point,
  type Rect,
  type Size,
  type WindowKind,
} from "@kladd/domain";
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
  /** No macOS window shadow: the surface draws its own, or has none. */
  readonly noShadow?: true;
  /** Starts letting clicks through; the UI turns that off over the parts it draws. */
  readonly clickThrough?: true;
  /** Covers the whole work area instead of opening at `size`. */
  readonly fill?: true;
  /** Floats above the other overlays, so nothing Kladd shows covers it. */
  readonly onTop?: true;
  /** Where the window opens when the caller gives no bounds. */
  readonly position: (size: Size, workArea: Rect) => { x: number; y: number };
}

/**
 * Every window Kladd has. Adding one starts with a WindowKind in packages/domain/src/Window.ts.
 */
const windowTable: Record<WindowKind, WindowSpec> = {
  pill: {
    // Matches the notch's SVG canvas (apps/ui/src/pill/notchShape.ts): the notch plus room to pull
    // it from the wall. The UI moves it while the user drags the notch.
    size: { width: 194, height: 194 },
    overlay: true,
    noShadow: true,
    clickThrough: true,
    onTop: true,
    // Docked on the left screen edge, four fifths down.
    position: (size, area) => ({
      x: area.x,
      y: Math.round(area.y + area.height * 0.8 - size.height / 2),
    }),
  },
  zones: {
    // Drawn over the whole work area, beneath the pill; clicks always go through to the apps below.
    size: { width: 0, height: 0 },
    overlay: true,
    noShadow: true,
    clickThrough: true,
    fill: true,
    position: (_size, area) => area,
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

// By centre point, not overlap: a caret is 0 wide, and getDisplayMatching gives a rect with no area
// the key window's display, which may not be the caret's.
const workArea = (near: Rect | null): Rect =>
  near === null
    ? screen.getPrimaryDisplay().workArea
    : screen.getDisplayNearestPoint({
        x: Math.round(near.x + near.width / 2),
        y: Math.round(near.y + near.height / 2),
      }).workArea;

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
    ...(spec.noShadow ? { hasShadow: false } : {}),
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
    // The relative level lifts the pill one step above the other overlays (macOS only).
    window.setAlwaysOnTop(true, "floating", spec.onTop ? 1 : 0);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (spec.clickThrough) window.setIgnoreMouseEvents(true, { forward: true });
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
      const target =
        bounds ?? (spec.fill ? area : { ...spec.size, ...spec.position(spec.size, area) });
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

    const moveTo = Effect.fn("OverlayWindows.moveTo")(function* (
      kind: WindowKind,
      position: Point,
    ) {
      const window = yield* get(kind);
      window.setPosition(Math.round(position.x), Math.round(position.y), false);
    });

    const setClickThrough = Effect.fn("OverlayWindows.setClickThrough")(function* (
      kind: WindowKind,
      clickThrough: boolean,
    ) {
      const window = yield* get(kind);
      window.setIgnoreMouseEvents(clickThrough, { forward: true });
    });

    return OverlayWindows.of({
      show,
      hide,
      prepare: (kind) => get(kind).pipe(Effect.asVoid),
      moveTo,
      setClickThrough,
      size: (kind) => windowTable[kind].size,
      workArea: (near) => Effect.sync(() => workArea(near)),
    });
  }),
);

/**
 * Kladd's presence: the pill is shown at startup and stays. Its snap zones are loaded behind it, so
 * they show the moment the pill is first dragged.
 */
export const PillLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const windows = yield* OverlayWindows;
    yield* windows.show("pill");
    yield* windows.prepare("zones");
  }),
);
