import type { Point, Rect, Size, WindowKind } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: shows, moves and hides Kladd's windows. Implemented in apps/desktop (src/main/windows.ts),
 * the only package that may import Electron. Test double: OverlayWindowsTest in ../testing.
 */
export class OverlayWindows extends Context.Service<
  OverlayWindows,
  {
    /** Shows the window without taking focus from the app the user is in. Moves it to `bounds` if given. */
    readonly show: (kind: WindowKind, bounds?: Rect) => Effect.Effect<void>;
    readonly hide: (kind: WindowKind) => Effect.Effect<void>;
    /** Creates and loads the window without showing it, so its first show is immediate. */
    readonly prepare: (kind: WindowKind) => Effect.Effect<void>;
    /** Moves the window's top-left corner to `position` without animating, so it can follow a drag. */
    readonly moveTo: (kind: WindowKind, position: Point) => Effect.Effect<void>;
    /** Lets clicks pass through the window to the apps below; it still sees the pointer move. */
    readonly setClickThrough: (kind: WindowKind, clickThrough: boolean) => Effect.Effect<void>;
    readonly size: (kind: WindowKind) => Size;
    /** Work area (screen minus Dock and menu bar) of the display nearest `rect`, or the main display. */
    readonly workArea: (rect: Rect | null) => Effect.Effect<Rect>;
  }
>()("kladd/core/OverlayWindows") {}
