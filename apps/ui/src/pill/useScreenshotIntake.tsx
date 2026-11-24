import { useAtomValue } from "@effect/atom-react";
import { screenshotUrl } from "@kladd/contract";
import type { Rect, ScreenshotFlight } from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { screenshotTrayAtom } from "../screenshot/atoms";
import type { NotchFrame } from "./notchPlacement";

/** A beat with the screenshot in the open tray before it shuts. */
const HOLD = 260;

interface Intake {
  readonly flight: ScreenshotFlight;
  /** Open while the screenshot flies, landed while the pill holds it, closing as the tray shuts. */
  readonly phase: "open" | "landed" | "closing";
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The intake (src/pill/intake.ts): while a ⌃⇧C screenshot flies to `landing`, the tray is `open`.
 * Once it has landed, `image` is where the flight window left it, which main hides a moment later
 * (`Screenshots.land`). The pill draws it inside the tray, clipped by the tray's own outline, so
 * when the tray shuts after a beat it hides the screenshot as it goes; the screenshot itself never
 * changes. Call `shut` once the tray has shut: only then is the screenshot thrown away. With
 * reduced motion the pill stays as it is.
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

  const id = intake?.flight.screenshot.id ?? null;
  const landed = intake !== null && intake.phase !== "open" ? id : null;

  // Decoded while it flies, so it shows the moment it lands.
  useEffect(() => {
    if (id === null) return;
    const preload = new Image();
    preload.src = screenshotUrl(id);
    preload.decode().then(
      () => {},
      () => {},
    );
  }, [id]);

  useEffect(() => {
    if (landed === null) return;
    const closing = setTimeout(
      () =>
        setIntake((now) =>
          now?.flight.screenshot.id === landed ? { ...now, phase: "closing" } : now,
        ),
      HOLD,
    );
    return () => clearTimeout(closing);
  }, [landed]);

  // Where the flight lands it, in the window.
  const to = intake?.flight.to;
  const landing: Rect | null =
    to === undefined ? null : { ...to, x: to.x - frame.window.x, y: to.y - frame.window.y };

  return {
    landing,
    image: landed === null || landing === null ? null : { ...landing, href: screenshotUrl(landed) },
    open: intake !== null && intake.phase !== "closing",
    closing: intake?.phase === "closing",
    shut: () =>
      setIntake((now) =>
        now?.phase === "closing" && now.flight.screenshot.id === landed ? null : now,
      ),
  };
};
