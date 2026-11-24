import { useAtomSet } from "@effect/atom-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from "react";
import { hideWindowAtom, showWindowAtom } from "../windows/atoms";
import { movePillAtom, setClickThroughAtom, setScreenshotSlotAtom } from "./atoms";
import { screenshotSlot } from "./intake";
import {
  clampCenter,
  frameAt,
  orientationOf,
  restingCenter,
  zoneAt,
  type Area,
  type NotchFrame,
  type Orientation,
  type Point,
  type Wall,
} from "./notchPlacement";
import { pill } from "./notchShape";
import { dockedLiquid, releaseLiquid, stepLiquid, viewLiquid, type Liquid } from "./wallLiquid";

/** Pointer travel before a press becomes a drag, so clicks on the buttons still work. */
const dragThreshold = 4;
/** The spring that pulls the pill onto its wall on release; underdamped, so it squishes a little. */
const stiffness = 420;
const damping = 22;
const axes: ReadonlyArray<"x" | "y"> = ["x", "y"];

/** The work area of the display the window is on, from the renderer's own `screen`. */
const workArea = (): Area => {
  const { screen } = window;
  const left = "availLeft" in screen && typeof screen.availLeft === "number" ? screen.availLeft : 0;
  const top = "availTop" in screen && typeof screen.availTop === "number" ? screen.availTop : 0;
  return { left, top, right: left + screen.availWidth, bottom: top + screen.availHeight };
};

interface Placed {
  readonly center: Point;
  readonly orientation: Orientation;
  readonly wall: Wall | null;
}

/** Main shows the window docked on the left wall (apps/desktop/src/main/windows.ts). */
const startFrame = (): NotchFrame => {
  const area = workArea();
  return frameAt(
    {
      x: area.left + pill.width / 2,
      y: window.screenY + window.innerHeight / 2,
    },
    "column",
    "left",
    area,
  );
};

/**
 * Drag the notch anywhere; while it is held, the SnapZones window tints every wall's zone. Let go
 * in a wall's zone and it springs onto that wall (a column on the
 * sides, a row on the bottom; never the top); let go elsewhere and it floats there. While it moves,
 * `moving` is true and `frame` changes every frame. R turns a floating pill between column and row,
 * also mid-drag; a docked one keeps the layout its wall gives it.
 * `liquid` says how the wall's liquid looks now (src/pill/wallLiquid.ts).
 * Also keeps clicks passing through the window everywhere but the notch (`data-notch-hit`), and
 * tells main where ⌃⇧C screenshots land in it once it rests.
 */
export const useNotchDrag = () => {
  const movePill = useAtomSet(movePillAtom);
  const setClickThrough = useAtomSet(setClickThroughAtom);
  const showWindow = useAtomSet(showWindowAtom);
  const hideWindow = useAtomSet(hideWindowAtom);
  const setScreenshotSlot = useAtomSet(setScreenshotSlotAtom);
  const [frame, setFrame] = useState<NotchFrame>(startFrame);
  const [moving, setMoving] = useState(false);
  const [liquid, setLiquid] = useState<Liquid>(() => dockedLiquid("left"));
  const [, redraw] = useState(0);
  /** Counts presses of R, so the view can animate the turn they ask for. */
  const [turns, setTurns] = useState(0);

  const placed = useRef<Placed | null>(null);
  const windowAt = useRef<Point | null>(null);
  const drag = useRef<{
    readonly pointer: number;
    readonly start: Point;
    grab: Point;
    active: boolean;
  } | null>(null);
  const spring = useRef<number | null>(null);
  const swallowClick = useRef(false);
  const clickThrough = useRef(true);
  const liquidNow = useRef(liquid);

  const show = (next: Placed) => {
    const shown = frameAt(next.center, next.orientation, next.wall, workArea());
    placed.current = next;
    setFrame(shown);
    liquidNow.current = stepLiquid(
      liquidNow.current,
      shown,
      drag.current?.active === true,
      performance.now(),
    );
    setLiquid(liquidNow.current);
    const last = windowAt.current;
    if (last?.x !== shown.window.x || last.y !== shown.window.y) {
      windowAt.current = shown.window;
      movePill({ payload: { position: shown.window } });
    }
  };

  /** Where the pill is now, from the window's position if it hasn't moved yet. */
  const current = (): Placed => {
    if (placed.current !== null) return placed.current;
    const { box, orientation, wall } = frame;
    const center = {
      x: window.screenX + box.left + box.width / 2,
      y: window.screenY + box.top + box.height / 2,
    };
    return { center, orientation, wall };
  };

  const stopSpring = () => {
    if (spring.current !== null) cancelAnimationFrame(spring.current);
    spring.current = null;
  };

  const release = () => {
    const { center, orientation, wall } = current();
    if (wall === null) {
      setMoving(false);
      return;
    }
    liquidNow.current = releaseLiquid(liquidNow.current, performance.now());
    setLiquid(liquidNow.current);
    // Springs onto the wall and, in a corner, along it until the flare fits on screen.
    const target = restingCenter(wall, center, workArea());
    const offset = { x: center.x - target.x, y: center.y - target.y };
    const velocity = { x: 0, y: 0 };
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      for (const axis of axes) {
        velocity[axis] += (-stiffness * offset[axis] - damping * velocity[axis]) * dt;
        offset[axis] += velocity[axis] * dt;
      }
      const done = Math.hypot(offset.x, offset.y) < 0.3 && Math.hypot(velocity.x, velocity.y) < 6;
      const at = done ? target : { x: target.x + offset.x, y: target.y + offset.y };
      show({ center: at, orientation, wall });
      if (done) {
        spring.current = null;
        setMoving(false);
      } else {
        spring.current = requestAnimationFrame(step);
      }
    };
    spring.current = requestAnimationFrame(step);
  };

  useEffect(() => stopSpring, []);

  // The window only gets keys once the notch has been clicked or grabbed (it is a non-activating panel).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "r" || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const now = current();
      if (now.wall !== null) return;
      // Turning keeps the centre (and any grab), so the window and the zones stay the same.
      setTurns((count) => count + 1);
      show({ ...now, orientation: now.orientation === "column" ? "row" : "column" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Clicks pass through the window except over the notch, or while dragging it.
  useEffect(() => {
    const update = (passThrough: boolean) => {
      if (passThrough === clickThrough.current) return;
      clickThrough.current = passThrough;
      setClickThrough({ payload: { clickThrough: passThrough } });
    };
    const onMove = (event: MouseEvent) => {
      const overNotch =
        event.target instanceof Element && event.target.closest("[data-notch-hit]") !== null;
      update(drag.current === null && !overNotch);
    };
    const onLeave = () => {
      if (drag.current === null) update(true);
    };
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [setClickThrough]);

  const end = (event: PointerEvent, clicked: boolean) => {
    const held = drag.current;
    if (held === null || held.pointer !== event.pointerId) return;
    drag.current = null;
    if (!held.active) return;
    swallowClick.current = clicked;
    hideWindow({ payload: { kind: "zones" } });
    release();
  };

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      stopSpring();
      swallowClick.current = false;
      const { center } = current();
      drag.current = {
        pointer: event.pointerId,
        start: { x: event.screenX, y: event.screenY },
        grab: { x: event.screenX - center.x, y: event.screenY - center.y },
        active: false,
      };
      if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent) => {
      const held = drag.current;
      if (held === null || held.pointer !== event.pointerId) return;
      if (!held.active) {
        const travel = Math.hypot(event.screenX - held.start.x, event.screenY - held.start.y);
        if (travel < dragThreshold) return;
        held.active = true;
        setMoving(true);
        showWindow({ payload: { kind: "zones" } });
      }
      const area = workArea();
      const before = current();
      // The grab stays as it was when the pill changes layout in a corner: the layouts meet at the
      // diagonal, so the pill's centre (and the turn, which follows it) stays continuous.
      const raw = { x: event.screenX - held.grab.x, y: event.screenY - held.grab.y };
      const wall = zoneAt(raw, area);
      const orientation = wall === null ? before.orientation : orientationOf(wall);
      show({ center: clampCenter(raw, orientation, wall, area), orientation, wall });
    },
    onPointerUp: (event: PointerEvent) => end(event, true),
    onPointerCancel: (event: PointerEvent) => end(event, false),
    // However the pointer is let go: a release the notch no longer sees still ends the drag.
    onLostPointerCapture: (event: PointerEvent) => end(event, false),
    /** A drag that ends on a button must not also click it. */
    onClickCapture: (event: ReactMouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };

  // Only at rest: while it moves, the frame changes every frame.
  useEffect(() => {
    if (moving) return;
    setScreenshotSlot({ payload: { slot: screenshotSlot(frame, workArea()) } });
  }, [frame, moving, setScreenshotSlot]);

  const view = viewLiquid(liquid, frame, performance.now());
  // The liquid also moves on its own (sinking back, the pull ramping in): redraw until it settles.
  useEffect(() => {
    if (!view.animating) return;
    const id = requestAnimationFrame(() => redraw((count) => count + 1));
    return () => cancelAnimationFrame(id);
  });

  return { frame, moving, liquid: view, turns, handlers };
};
