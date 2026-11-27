import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { elapsed, sessionState } from "@kladd/domain";
import { DateTime, Duration } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import {
  clipAtom,
  endSessionAtom,
  finishLoggingAtom,
  openLoggingOverlayAtom,
  sessionAtom,
  startSessionAtom,
  takeScreenshotAtom,
  toggleClipAtom,
} from "../session/atoms";
import { openMenuAtom } from "./atoms";
import type { Orientation, Wall } from "./notchPlacement";
import { attractRange, canvas, dropParts, dropPath } from "./notchShape";
import { panelBeside, panelFromWall, roundedPath, trayRects } from "./intake";
import { useNotchDrag, workArea } from "./useNotchDrag";
import { useScreenshotIntake } from "./useScreenshotIntake";

const formatElapsed = (duration: Duration.Duration): string => {
  // Clamped: the first render after a start can read a clock from before it.
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(duration)));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

/** Re-renders every second while `active`. */
const useNow = (active: boolean): DateTime.Utc => {
  const [now, setNow] = useState(DateTime.nowUnsafe);
  useEffect(() => {
    if (!active) return;
    setNow(DateTime.nowUnsafe());
    const timer = setInterval(() => setNow(DateTime.nowUnsafe()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

type ShapeVars = CSSProperties & Record<`--${string}`, string>;

const path = (d: string) => `path("${d}")`;

/**
 * The resting shapes, read by the `.notch-drop` rules in styles.css: docked ones swell on hover and
 * squish on press; a floating pill stays as it is.
 */
const restingVars = (docked: boolean, offset: number, along: number): ShapeVars => {
  if (!docked) {
    // Shaped as if out of every wall's reach, wherever it sits in the window.
    const plain = path(dropPath({ gap: offset, top: along, shapeGap: attractRange }));
    return { "--drop-rest": plain, "--drop-hover": plain, "--drop-press": plain };
  }
  return {
    "--drop-rest": path(dropPath({ gap: 0, top: along })),
    "--drop-hover": path(dropPath({ gap: 0, top: along, reach: 52 })),
    "--drop-press": path(dropPath({ gap: 0, top: along, reach: 43 })),
  };
};

const size = canvas.width;
/** One flat colour for the pill, the wall's liquid and what the wall lets go of. */
const liquidColor = "#18181b";

/** Turns the shape, drawn against a left wall, to face `wall`. */
const faceWall: Record<Wall, string> = {
  left: "matrix(1 0 0 1 0 0)",
  right: `matrix(-1 0 0 1 ${size} 0)`,
  top: "matrix(0 1 1 0 0 0)",
  bottom: `matrix(0 -1 1 0 0 ${size})`,
};
/** The expand chevron points away from the wall, out into the screen. */
const awayFrom: Record<Wall, number> = { left: 0, right: 180, top: 90, bottom: -90 };

/**
 * Turns the notch a quarter when R switches it between column and row, about the pill's centre.
 * Column to row starts turned clockwise, so the first button comes from the top to the left. Corner
 * changes of layout need no animation: the pill's tilt follows its position there.
 */
const useTurn = (turns: number, orientation: Orientation, origin: string) => {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(turns);
  useEffect(() => {
    if (previous.current === turns) return;
    previous.current = turns;
    const element = ref.current;
    if (element === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.style.transformOrigin = origin;
    element.animate([{ rotate: orientation === "row" ? "90deg" : "-90deg" }, { rotate: "0deg" }], {
      duration: 150,
      easing: "ease-out",
    });
  }, [turns, orientation, origin]);
  return ref;
};

const NotchButton = ({
  label,
  onClick,
  className,
  children,
}: {
  readonly label: string;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <Button
    aria-label={label}
    title={label}
    data-notch-hit
    {...(onClick === undefined ? {} : { onClick })}
    className={cn(
      "pointer-events-auto grid size-8 place-items-center rounded-full border-0 bg-transparent p-0 text-neutral-400",
      "transition-[background-color,color,scale] duration-150 ease-out",
      "hover:bg-white/10 hover:text-white active:scale-90",
      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/40",
      className,
    )}
  >
    {children}
  </Button>
);

const icon = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Slide the settings panel out of the notch. Points `angle` degrees from pointing right. */
const ExpandIcon = ({ angle }: { readonly angle: number }) => (
  <svg
    {...icon}
    className="transition-[rotate] duration-200 ease-out"
    style={{ rotate: `${angle}deg` }}
  >
    <path d="M6.5 4 10.5 8l-4 4" />
  </svg>
);

/** A viewfinder: corners around a dot. */
const ScreenshotIcon = () => (
  <svg {...icon}>
    <path d="M2.75 5.5V4.25c0-.83.67-1.5 1.5-1.5H5.5M10.5 2.75h1.25c.83 0 1.5.67 1.5 1.5V5.5M13.25 10.5v1.25c0 .83-.67 1.5-1.5 1.5H10.5M5.5 13.25H4.25c-.83 0-1.5-.67-1.5-1.5V10.5" />
    <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
  </svg>
);

/** A rounded square: end the session. */
const StopIcon = () => (
  <svg {...icon}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** A pencil: write the log, in the logging overlay. */
const WriteIcon = () => (
  <svg {...icon}>
    <path d="M10.5 3.25 12.75 5.5 6 12.25H3.75V10z" />
  </svg>
);

/** A checkmark: the log is written. */
const DoneIcon = () => (
  <svg {...icon}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

/** Static: a ring to start, a lit red dot while recording. */
const RecordIndicator = ({ recording }: { readonly recording: boolean }) => (
  <span
    className={cn(
      "grid size-4 place-items-center rounded-full transition-[box-shadow,border-color] duration-200",
      recording
        ? "border-0 shadow-[0_0_0_3px_rgb(239_68_68/0.22),0_0_10px_rgb(239_68_68/0.55)]"
        : "border-[1.5px] border-current",
    )}
  >
    <span
      className={cn(
        "rounded-full transition-[width,height,background-color] duration-200",
        recording ? "size-3 bg-red-500" : "size-1.5 bg-current",
      )}
    />
  </span>
);

/**
 * The pill's buttons for each state of the open session (domain sessionState): none, so start one or
 * look at past sessions; active, so take screenshots and clips or end it; ended, so write the log
 * (logging mode, GLOSSARY: "loggemodus") and tick it off.
 */
const SessionButtons = () => {
  const opened = useAtomValue(sessionAtom);
  const clipping = useAtomValue(clipAtom);
  const session = AsyncResult.isSuccess(opened) ? opened.value : null;
  const clip = AsyncResult.isSuccess(clipping) ? clipping.value : null;
  const state = session === null ? null : sessionState(session);
  const now = useNow(state === "active");
  const start = useAtomSet(startSessionAtom);
  const end = useAtomSet(endSessionAtom);
  const finishLogging = useAtomSet(finishLoggingAtom);
  const screenshot = useAtomSet(takeScreenshotAtom);
  const toggleClip = useAtomSet(toggleClipAtom);
  const openLogging = useAtomSet(openLoggingOverlayAtom);
  const run = (action: (options: { payload: undefined }) => void) => () =>
    action({ payload: undefined });

  if (session === null || state === "logged") {
    return (
      <NotchButton label="Start session" className="size-9" onClick={run(start)}>
        <RecordIndicator recording={false} />
      </NotchButton>
    );
  }
  if (state === "ended") {
    return (
      <>
        <NotchButton label="Write the log" onClick={run(openLogging)}>
          <WriteIcon />
        </NotchButton>
        <NotchButton
          label="Done logging"
          className="size-9 text-emerald-400 hover:text-emerald-300"
          onClick={run(finishLogging)}
        >
          <DoneIcon />
        </NotchButton>
      </>
    );
  }
  return (
    <>
      <NotchButton label="Take screenshot (⌃⇧C)" onClick={run(screenshot)}>
        <ScreenshotIcon />
      </NotchButton>
      <NotchButton
        label={
          clip === null
            ? "Start clip (⌥⇧C)"
            : `Stop clip (${formatElapsed(DateTime.distance(clip, now))})`
        }
        className={cn("size-9", clip !== null && "text-red-500 hover:text-red-400")}
        onClick={run(toggleClip)}
      >
        <RecordIndicator recording={clip !== null} />
      </NotchButton>
      <NotchButton
        label={`End session (${formatElapsed(elapsed(session, now))})`}
        onClick={run(end)}
      >
        <StopIcon />
      </NotchButton>
    </>
  );
};

/**
 * The settings panel (src/pill/intake.ts) slides out when the chevron is clicked, and back when it
 * is clicked again: out of the wall, pushing a docked pill off it, or out of a floating pill as its
 * tray. It shuts at once when the pill is dragged, and slides shut when a session starts, which
 * hides the chevron, or a screenshot comes in.
 */
const useSettingsPanel = (moving: boolean, busy: boolean) => {
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [panel, setPanel] = useState<"open" | "closing" | null>(null);
  const close = () => setPanel((now) => (now === "open" ? (still ? null : "closing") : now));
  if (moving && panel !== null) setPanel(null);
  else if (busy && panel === "open") setPanel(still ? null : "closing");
  return {
    panel,
    toggle: () => (panel === "open" ? close() : setPanel("open")),
    shut: () => setPanel((now) => (now === "closing" ? null : now)),
  };
};

/**
 * RecordingPill: Kladd's only presence, a notch of liquid docked on a screen edge (a column on the
 * sides, a row on the bottom) or floating. Holds the settings panel and the session's buttons
 * (SessionButtons), and opens to take in a screenshot (src/pill/intake.ts). Drag it to move it:
 * it is a plain pill in the open, an edge pulls it in when it comes close, and a ghost shows where
 * it will dock. Right-click opens the menu.
 */
export const RecordingPill = () => {
  const opened = useAtomValue(sessionAtom);
  const openMenu = useAtomSet(openMenuAtom);
  const active =
    AsyncResult.isSuccess(opened) &&
    opened.value !== null &&
    sessionState(opened.value) === "active";
  const { frame, moving, liquid, turns, handlers } = useNotchDrag();
  const { box, drawWall, orientation } = frame;

  const intake = useScreenshotIntake(frame);
  const settings = useSettingsPanel(moving, active || intake.landing !== null);
  const fromWall =
    settings.panel !== null && frame.wall !== null
      ? panelFromWall({ ...frame, wall: frame.wall })
      : null;
  const beside =
    settings.panel !== null && fromWall === null ? panelBeside(frame, workArea()) : null;
  const besideTray = beside === null ? null : trayRects(frame, beside);
  const panelVars: ShapeVars | null =
    fromWall !== null
      ? { "--tray-shut": path(fromWall.shut), "--tray-open": path(fromWall.open) }
      : besideTray !== null
        ? {
            "--tray-shut": path(roundedPath(besideTray.shut)),
            "--tray-open": path(roundedPath(besideTray.open)),
          }
        : null;
  const content = fromWall?.content ?? beside;
  const push = settings.panel === "open" && fromWall !== null ? fromWall.push : { x: 0, y: 0 };
  const pushed = cn("notch-push", settings.panel === "closing" && "shutting");
  const pushStyle = { translate: `${push.x}px ${push.y}px` };
  const resting = useMemo(
    () => restingVars(frame.wall !== null, frame.offset, frame.along),
    [frame.wall, frame.offset, frame.along],
  );
  const tray = intake.landing === null ? null : trayRects(frame, intake.landing);
  const trayVars: ShapeVars | null =
    tray === null
      ? null
      : {
          "--tray-shut": path(roundedPath(tray.shut)),
          "--tray-open": path(roundedPath(tray.open)),
        };
  // While it moves, the wall's liquid and the pill are drawn apart: in a corner the pill tilts and
  // the wall's liquid doesn't, and once the pill leaves the wall only the pill follows it.
  const parts = dropParts({
    gap: frame.offset,
    top: frame.along,
    shapeGap: liquid.shapeGap,
    lean: liquid.attached,
  });
  const live = path(parts.body);
  const liveWall = moving && liquid.attached ? parts.wall : null;
  const pillCenter = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const tilted = `rotate(${frame.tilt} ${pillCenter.x} ${pillCenter.y}) ${faceWall[drawWall]}`;
  const { residue } = liquid;
  const shapeVars: ShapeVars = moving ? { ...resting, "--drop-live": live } : resting;
  const turn = useTurn(turns, orientation, `${pillCenter.x}px ${pillCenter.y}px`);

  return (
    <div
      className={cn(
        "notch pointer-events-none relative h-screen w-screen touch-none select-none",
        moving && "live",
        intake.closing && "closing",
      )}
      {...handlers}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu({ payload: undefined });
      }}
    >
      {/*
        Liquid a wall let go of: it stays put on screen and sinks back into the wall. Outside the
        turn, so it never swings round with the pill.
      */}
      {residue !== null && (
        <svg
          className="absolute inset-0 overflow-visible"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
        >
          <g
            filter="url(#drop-shadow)"
            transform={`translate(${residue.offset.x} ${residue.offset.y})`}
          >
            <path
              transform={`${faceWall[residue.wall]} translate(0 ${residue.mid}) scale(${residue.scale} ${0.6 + 0.4 * residue.scale}) translate(0 ${-residue.mid})`}
              d={residue.path}
              fill={liquidColor}
            />
          </g>
        </svg>
      )}
      <div ref={turn} className="absolute inset-0">
        <svg
          className="absolute inset-0 overflow-visible"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={shapeVars}
          aria-hidden
        >
          <defs>
            <filter id="drop-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow
                dx="0"
                dy="3"
                stdDeviation="3.5"
                floodColor="#000"
                floodOpacity="0.32"
              />
            </filter>
            {trayVars !== null && (
              <clipPath id="tray-clip">
                <path className={cn("notch-tray", intake.open && "open")} style={trayVars} />
              </clipPath>
            )}
          </defs>
          {/* The shadow sits outside the turn, so it always falls down the screen. */}
          <g filter="url(#drop-shadow)">
            {liveWall !== null && (
              <path transform={faceWall[drawWall]} d={liveWall} fill={liquidColor} />
            )}
            {panelVars !== null && (
              <path
                className={cn(
                  "notch-tray pointer-events-auto",
                  settings.panel === "open" && "open",
                  settings.panel === "closing" && "shutting",
                )}
                data-notch-hit
                style={panelVars}
                {...(fromWall === null ? {} : { transform: faceWall[drawWall] })}
                fill={liquidColor}
                onTransitionEnd={(event) => {
                  if (event.propertyName === "d") settings.shut();
                }}
              />
            )}
            <g className={pushed} style={pushStyle}>
              <path
                className="notch-drop pointer-events-auto"
                data-notch-hit
                transform={tilted}
                fill={liquidColor}
              />
            </g>
            {trayVars !== null && (
              <path
                className={cn("notch-tray", intake.open && "open")}
                style={trayVars}
                fill={liquidColor}
                onTransitionEnd={intake.shut}
              />
            )}
          </g>
          {/* In the tray: it shows only what the tray covers, so the tray hides it as it shuts. */}
          {intake.image !== null && (
            <image {...intake.image} preserveAspectRatio="none" clipPath="url(#tray-clip)" />
          )}
        </svg>

        {content !== null && (
          <div
            data-notch-hit
            className={cn(
              "pointer-events-auto absolute grid place-items-center text-sm text-neutral-400",
              settings.panel === "open"
                ? "opacity-100 transition-opacity delay-150 duration-200 starting:opacity-0"
                : "opacity-0 transition-opacity duration-100",
            )}
            style={{
              left: content.x,
              top: content.y,
              width: content.width,
              height: content.height,
            }}
          >
            Trolled, no settings yet
          </div>
        )}
        <div
          className={cn(
            "absolute flex items-center justify-center gap-1",
            orientation === "column" ? "flex-col" : "flex-row",
            pushed,
          )}
          style={{
            ...pushStyle,
            left: Math.min(Math.max(box.left, 0), size - box.width),
            top: Math.min(Math.max(box.top, 0), size - box.height),
            width: box.width,
            height: box.height,
            rotate: `${frame.tilt}deg`,
          }}
        >
          {!active && (
            <NotchButton
              label={settings.panel === "open" ? "Close settings" : "Settings"}
              onClick={settings.toggle}
            >
              <ExpandIcon angle={awayFrom[drawWall] + (settings.panel === "open" ? 180 : 0)} />
            </NotchButton>
          )}
          <SessionButtons />
        </div>
      </div>
    </div>
  );
};
