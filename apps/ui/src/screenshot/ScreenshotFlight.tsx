import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { screenshotUrl } from "@kladd/contract";
import type { ScreenshotFlight as Flight } from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { hideWindowAtom } from "../windows/atoms";
import { landScreenshotAtom, screenshotTrayAtom } from "./atoms";
import { type Spring, springTiming } from "./spring";

/** A held beat after the flash, so the user sees what was captured before it flies. */
const HOLD = 120;
const FLASH = 260;
/** The drop into the pill. It starts before the springs settle, while the screenshot still moves. */
const ABSORB = 240;
const ABSORB_OVERLAP = 160;

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
  readonly body: HTMLDivElement;
}

/**
 * Plays one flight and calls `done` once the screenshot has dropped into the pill. Returns a
 * function that stops it.
 *
 * Every animation here is translate, scale or opacity, which the compositor runs on the GPU without
 * repainting the full-resolution screenshot. Radius, shadow or anything else that repaints drops
 * frames at this size, and runs Chromium out of tile memory, so parts of the screenshot don't draw.
 */
const fly = (parts: Parts, flight: Flight, done: () => void) => {
  const { from, to } = flight;
  const scale = to.width / from.width;
  const x = springTiming(travelX);
  const y = springTiming(travelY);
  const s = springTiming(shrink);
  const travel = Math.max(x.duration, y.duration, s.duration);
  const absorbAt = HOLD + travel - ABSORB_OVERLAP;
  const fill = "both" as const;

  const animations = [
    parts.flash.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.25 }, { opacity: 0 }], {
      duration: FLASH,
      easing: "ease-out",
    }),
    // The screen behind dims a little while the screenshot is lifted off it.
    parts.dim.animate([{ opacity: 0 }, { opacity: 0.16, offset: 0.15 }, { opacity: 0 }], {
      duration: absorbAt,
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
    // Into the pill: shrinks about its own centre and fades, as if it went in.
    parts.body.animate(
      [
        { scale: "1", opacity: 1 },
        { scale: "0.25", opacity: 0 },
      ],
      { duration: ABSORB, delay: absorbAt, easing: "cubic-bezier(0.55, 0, 0.75, 0)", fill },
    ),
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
 * the screen exactly, so the screen seems to freeze, then flashes, lifts and springs onto the pill
 * (a shared element transition), and drops into it. The pill itself doesn't change. How it fits
 * together: docs/internals/screenshot-flight.md.
 */
export const ScreenshotFlight = () => {
  const tray = useAtomValue(screenshotTrayAtom);
  const land = useAtomSet(landScreenshotAtom);
  const hideWindow = useAtomSet(hideWindowAtom);
  const flying = AsyncResult.isSuccess(tray) ? tray.value.flying : null;
  // The flight being played. Main clears `flying` once it lands, so only a new flight replaces it.
  const [flight, setFlight] = useState<Flight | null>(null);
  if (flying !== null && flying.screenshot.id !== flight?.screenshot.id) setFlight(flying);

  const flash = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const [f, d, xe, c, b, img] = [
      flash.current,
      dim.current,
      x.current,
      card.current,
      body.current,
      image.current,
    ];
    if (flight === null || f === null || d === null || xe === null || c === null) return;
    if (b === null || img === null) return;

    const { id } = flight.screenshot;
    const finish = () => {
      c.style.visibility = "hidden";
      land({ payload: { id } });
      hideWindow({ payload: { kind: "flight" } });
    };
    if (reducedMotion()) {
      finish();
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
          stop = fly({ flash: f, dim: d, x: xe, card: c, body: b }, flight, finish);
        });
      },
      () => cancelled || finish(),
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [flight, land, hideWindow]);

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
          <div ref={body} className="size-full origin-center will-change-transform">
            <img ref={image} alt="" className="block size-full" draggable={false} />
          </div>
        </div>
      </div>
      <div ref={flash} className="absolute inset-0 bg-white opacity-0" />
    </div>
  );
};
