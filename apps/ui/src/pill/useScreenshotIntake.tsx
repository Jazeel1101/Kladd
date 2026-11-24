import { useAtomValue } from "@effect/atom-react";
import { screenshotUrl } from "@kladd/contract";
import type { ScreenshotFlight } from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { screenshotTrayAtom } from "../screenshot/atoms";
import type { NotchFrame } from "./notchPlacement";

/** A beat with the screenshot in the open pill before it closes. */
const HOLD = 260;
/** Closing over the screenshot. The `.notch.closing` rule in styles.css runs the shape on this timing. */
const CLOSE = 420;
const closeEasing = "cubic-bezier(0.32, 0.72, 0, 1)";
/** The screenshot's corners in the pill. The flight lands it square, so they round off in the hold. */
const radius = 8;

interface Intake {
  readonly flight: ScreenshotFlight;
  /** Open while the screenshot flies, landed while the pill holds it, closing over it after. */
  readonly phase: "open" | "landed" | "closing";
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** How much of a span [start, start + size) lies outside [from, from + length), on each side. */
const outside = (start: number, size: number, from: number, length: number) =>
  [clamp(from - start, 0, size), clamp(start + size - (from + length), 0, size)] as const;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The intake (src/pill/intake.ts): while a ⌃⇧C screenshot flies, the pill is `open`. Once it has
 * landed, `thumbnail` shows it where the flight window left it, which main hides a moment later
 * (`Screenshots.land`); after a beat the pill is `closing` and closes over it, the screenshot
 * sliding into the pill's resting box as it goes. With reduced motion the pill stays as it is.
 */
export const useScreenshotIntake = (frame: NotchFrame) => {
  const tray = useAtomValue(screenshotTrayAtom);
  const flying = AsyncResult.isSuccess(tray) ? tray.value.flying : null;
  const [still] = useState(reducedMotion);
  const [intake, setIntake] = useState<Intake | null>(null);
  if (!still && flying !== null && flying.screenshot.id !== intake?.flight.screenshot.id) {
    setIntake({ flight: flying, phase: "open" });
  } else if (flying === null && intake?.phase === "open") {
    setIntake({ ...intake, phase: "landed" });
  }

  const element = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const id = intake?.flight.screenshot.id ?? null;
  const landed = intake !== null && intake.phase !== "open" ? id : null;

  // In the window, where the flight leaves it, and what of it lies outside the resting pill.
  const to = intake?.flight.to;
  const at = to && { left: to.x - frame.window.x, top: to.y - frame.window.y };
  const { box } = frame;
  const [top, bottom] = to && at ? outside(at.top, to.height, box.top, box.height) : [0, 0];
  const [left, right] = to && at ? outside(at.left, to.width, box.left, box.width) : [0, 0];
  const closed = `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
  const shift =
    to && at
      ? `${0.4 * (box.left + box.width / 2 - at.left - to.width / 2)}px ${0.4 * (box.top + box.height / 2 - at.top - to.height / 2)}px`
      : "0px 0px";

  // Decoded while it flies, so it shows the moment it lands.
  useEffect(() => {
    if (id !== null)
      image.current?.decode().then(
        () => {},
        () => {},
      );
  }, [id]);

  useEffect(() => {
    const [held, img] = [element.current, image.current];
    if (landed === null || held === null || img === null) return;
    const total = HOLD + CLOSE;
    const fill = "forwards" as const;
    const animations = [
      held.animate(
        [
          { clipPath: "inset(0px round 0px)" },
          { clipPath: `inset(0px round ${radius}px)`, offset: HOLD / 2 / total },
          { clipPath: `inset(0px round ${radius}px)`, offset: HOLD / total, easing: closeEasing },
          { clipPath: closed },
        ],
        { duration: total, fill },
      ),
      img.animate([{ translate: "0px 0px" }, { translate: shift }], {
        delay: HOLD,
        duration: CLOSE,
        easing: closeEasing,
        fill,
      }),
      // A floating pill's box still shows the middle of it: that part fades as the pill closes.
      held.animate([{ opacity: 1 }, { opacity: 0 }], {
        delay: HOLD + CLOSE / 2,
        duration: CLOSE / 2,
        fill,
      }),
    ];
    const ours = (now: Intake | null) => now?.flight.screenshot.id === landed;
    const closing = setTimeout(
      () => setIntake((now) => (now !== null && ours(now) ? { ...now, phase: "closing" } : now)),
      HOLD,
    );
    Promise.all(animations.map((a) => a.finished)).then(
      () => setIntake((now) => (ours(now) ? null : now)),
      () => {},
    );
    return () => {
      clearTimeout(closing);
      animations.forEach((a) => a.cancel());
    };
  }, [landed, closed, shift]);

  const thumbnail: ReactNode =
    intake === null || to === undefined || at === undefined ? null : (
      <div
        ref={element}
        className="pointer-events-none absolute overflow-hidden"
        style={{
          ...at,
          width: to.width,
          height: to.height,
          visibility: landed === null ? "hidden" : "visible",
        }}
      >
        <img
          ref={image}
          src={screenshotUrl(intake.flight.screenshot.id)}
          alt=""
          className="block size-full"
          draggable={false}
        />
      </div>
    );

  return {
    open: intake !== null && intake.phase !== "closing",
    closing: intake?.phase === "closing",
    thumbnail,
  };
};
