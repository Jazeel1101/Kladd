import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { screenshotUrl } from "@kladd/contract";
import type { ScreenshotFlight as Flight } from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { landScreenshotAtom, screenshotTrayAtom } from "./atoms";
import { type Spring, springTiming } from "./spring";

/** A held beat after the flash, so the user sees what was captured before it flies. */
const HOLD = 120;
const FLASH = 260;
/**
 * How long the landed screenshot stays in this window. Main hides the window sooner, once the pill
 * shows its own copy underneath (`Screenshots.land`); clearing it after that leaves the hidden
 * window empty, so its next flight doesn't open on this one.
 */
const CLEAR = 400;

// Horizontal and vertical travel on different springs, so the screenshot arcs instead of sliding
// in a straight line. Scale settles with a small overshoot, so it arrives with a little give.
const travelX: Spring = { stiffness: 120, damping: 19 };
const travelY: Spring = { stiffness: 190, damping: 25 };
const shrink: Spring = { stiffness: 150, damping: 21 };

interface Parts {
  readonly flash: HTMLDivElement;
  readonly dim: HTMLDivElement;
  readonly x: HTMLDivElement;
  readonly card: HTMLDivElement;
}

/**
 * Plays one flight and calls `done` once the screenshot rests in the slot of the pill's open tray. Returns a
 * function that stops it.
 *
 * Every animation here is translate, scale or opacity, which the compositor runs on the GPU without
 * repainting the full-resolution screenshot. Radius, shadow or anything else that repaints drops
 * frames at this size, and runs Chromium out of tile memory, so parts of the screenshot don't draw.
 * The pill rounds its corners once it holds it (src/pill/useScreenshotIntake.tsx).
 */
const fly = (parts: Parts, flight: Flight, done: () => void) => {
  const { from, to } = flight;
  const scale = to.width / from.width;
  const x = springTiming(travelX);
  const y = springTiming(travelY);
  const s = springTiming(shrink);
  const travel = Math.max(x.duration, y.duration, s.duration);
  const fill = "both" as const;

  const animations = [
    parts.flash.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.25 }, { opacity: 0 }], {
      duration: FLASH,
      easing: "ease-out",
    }),
    // The screen behind dims a little while the screenshot is lifted off it.
    parts.dim.animate([{ opacity: 0 }, { opacity: 0.16, offset: 0.15 }, { opacity: 0 }], {
      duration: HOLD + travel,
      easing: "ease-out",
      fill,
    }),
    parts.x.animate([{ translate: "0px 0px" }, { translate: `${to.x - from.x}px 0px` }], {
      ...x,
      delay: HOLD,
      fill,
    }),
    parts.card.animate([{ translate: "0px 0px" }, { translate: `0px ${to.y - from.y}px` }], {
      ...y,
      delay: HOLD,
      fill,
    }),
    parts.card.animate([{ scale: "1" }, { scale: String(scale) }], { ...s, delay: HOLD, fill }),
  ];

  let stopped = false;
  Promise.all(animations.map((a) => a.finished)).then(
    () => stopped || done(),
    () => {},
  );
  return () => {
    stopped = true;
    animations.forEach((a) => a.cancel());
  };
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `f` once the browser has painted the current frame and is about to paint the next. */
const afterNextPaint = (f: () => void) => {
  let id = requestAnimationFrame(() => {
    id = requestAnimationFrame(f);
  });
  return () => cancelAnimationFrame(id);
};

/**
 * ScreenshotFlight: a click-through window over the whole display. A new screenshot starts covering
 * the screen exactly, so the screen seems to freeze, then flashes, lifts and springs into the tray
 * the pill slides out for it (a shared element transition), where the pill takes over. How it fits
 * together: docs/internals/screenshot-flight.md.
 */
export const ScreenshotFlight = () => {
  const tray = useAtomValue(screenshotTrayAtom);
  const land = useAtomSet(landScreenshotAtom);
  const flying = AsyncResult.isSuccess(tray) ? tray.value.flying : null;
  // The flight being played. Main clears `flying` once it lands, so only a new flight replaces it.
  const [flight, setFlight] = useState<Flight | null>(null);
  if (flying !== null && flying.screenshot.id !== flight?.screenshot.id) setFlight(flying);

  const flash = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const [f, d, xe, c, img] = [flash.current, dim.current, x.current, card.current, image.current];
    if (flight === null || f === null || d === null || xe === null || c === null) return;
    if (img === null) return;

    const { id } = flight.screenshot;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      // Main attaches it and hides this window, unless a newer screenshot is already flying.
      land({ payload: { id } });
      clear = setTimeout(() => (c.style.visibility = "hidden"), CLEAR);
    };
    if (reducedMotion()) {
      c.style.visibility = "hidden";
      land({ payload: { id } });
      return;
    }

    let stop = () => {};
    let cancelled = false;
    c.style.visibility = "hidden";
    img.src = screenshotUrl(id);
    // Decoded, then painted once before the clock starts: the GPU upload of the full-resolution
    // image happens in that first frame instead of eating the start of the animation.
    img.decode().then(
      () => {
        if (cancelled) return;
        c.style.visibility = "visible";
        stop = afterNextPaint(() => {
          stop = fly({ flash: f, dim: d, x: xe, card: c }, flight, finish);
        });
      },
      () => {
        if (cancelled) return;
        c.style.visibility = "hidden";
        land({ payload: { id } });
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(clear);
      stop();
    };
  }, [flight, land]);

  const from = flight?.from;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div ref={dim} className="absolute inset-0 bg-black opacity-0" />
      <div ref={x} className="absolute top-0 left-0">
        <div
          ref={card}
          className="origin-top-left"
          style={{ width: from?.width ?? 0, height: from?.height ?? 0 }}
        >
          {/* The one big layer: rastered once at full size, then only moved and scaled. */}
          <img
            ref={image}
            alt=""
            className="block size-full will-change-transform"
            draggable={false}
          />
        </div>
      </div>
      <div ref={flash} className="absolute inset-0 bg-white opacity-0" />
    </div>
  );
};
