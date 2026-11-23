import type { Rect, Size, WindowKind } from "@kladd/domain";
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
    readonly size: (kind: WindowKind) => Size;
    /** Work area (screen minus Dock and menu bar) of the display nearest `rect`, or the main display. */
    readonly workArea: (rect: Rect | null) => Effect.Effect<Rect>;
  }
>()("kladd/core/OverlayWindows") {}
