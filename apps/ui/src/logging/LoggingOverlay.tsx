import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  closedLoggingOverlay,
  overlayMargin,
  type LoggingOverlayState,
  type WritingTarget,
} from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { liquidColor } from "../lib/liquid";
import { setClickThroughAtom } from "../windows/atoms";
import { loggingOverlayAtom, summaryAtom } from "./atoms";
import { KladdIcon } from "./icons";
import { growOrigin, neck, panelRadius } from "./neck";
import { Summary } from "./Summary";

/** Where the student writes, as the app adapter reports it: "Microsoft OneNote › Uke 3". */
const where = ({ app, document }: WritingTarget): string => {
  const parts = [app, document].filter((part) => part !== null);
  return parts.length === 0 ? "Finner ikke hvor du skriver" : `Følger: ${parts.join(" › ")}`;
};

const Header = ({ title, target }: { readonly title: string; readonly target: WritingTarget }) => (
  <header className="flex items-center gap-3 px-5 pt-5 pb-4 select-none">
    <KladdIcon size={36} />
    {/* Padded on the right as wide as the icon, so the title sits in the panel's middle. */}
    <div className="flex min-w-0 flex-1 flex-col items-center pr-12 text-center">
      <h1 className="text-[15px] font-medium tracking-[-0.01em] text-zinc-50">{title}</h1>
      <p className="max-w-full truncate text-xs text-zinc-400">{where(target)}</p>
    </div>
  </header>
);

const Setting = ({ title, text }: { readonly title: string; readonly text: string }) => (
  <li className="flex flex-col gap-1 rounded-xl bg-zinc-800/80 px-4 py-3">
    <div className="flex items-baseline justify-between gap-2">
      <p className="font-medium text-zinc-100">{title}</p>
      <p className="text-xs text-zinc-500">Kommer snart</p>
    </div>
    <p className="text-zinc-400">{text}</p>
  </li>
);

/** The log's settings, swapped in for the summary by the pill's gear. */
const LogSettings = () => (
  <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5 leading-relaxed">
    <Setting title="Språkmodell" text="Hvilken modell som skriver loggen." />
    <Setting
      title="Nøkkel eller abonnement"
      text="Din egen nøkkel eller ditt abonnement. Den blir på denne Macen, og loggen går bare dit."
    />
  </ul>
);

/** The overlay's window lets clicks through everywhere but its panel and neck (`data-overlay-hit`). */
const useClickThrough = () => {
  const setClickThrough = useAtomSet(setClickThroughAtom);
  useEffect(() => {
    // The window starts letting clicks through (apps/desktop windows.ts).
    let through = true;
    const update = (next: boolean) => {
      if (next === through) return;
      through = next;
      setClickThrough({ payload: { kind: "logging", clickThrough: next } });
    };
    const onMove = (event: MouseEvent) =>
      update(!(event.target instanceof Element && event.target.closest("[data-overlay-hit]")));
    const onLeave = () => update(true);
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [setClickThrough]);
};

/**
 * Each time the overlay opens, its panel springs out of the join with the pill, with the notch's
 * overshoot, and the neck fades in with it. Only transform and opacity animate, so the compositor
 * runs it without repainting the panel. Core shows the window with the new join before it says the
 * overlay is open.
 */
const useGrow = (
  panel: React.RefObject<HTMLElement | null>,
  neckPath: React.RefObject<SVGSVGElement | null>,
  state: LoggingOverlayState,
) => {
  const { open, join } = state;
  const joinAtOpen = useRef(join);
  joinAtOpen.current = join;
  useEffect(() => {
    const element = panel.current;
    if (!open || element === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = joinAtOpen.current;
    const size = { width: element.offsetWidth, height: element.offsetHeight };
    element.style.transformOrigin = from === null ? "center" : growOrigin(from, size);
    const timing = { duration: 380, easing: "cubic-bezier(0.34, 1.3, 0.64, 1)" };
    element.animate(
      [
        { transform: `scale(${from === null ? 0.96 : 0.3})`, opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { transform: "scale(1)", opacity: 1 },
      ],
      timing,
    );
    neckPath.current?.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }],
      timing,
    );
  }, [open, panel, neckPath]);
};

/**
 * LoggingOverlay (GLOSSARY: "loggeoverlegg"): the ended session's summary, which the student writes
 * their log from. It grows out of the pill's notch when a session ends, and the two read as one
 * shape: its window lies under the pill's and draws the neck where they join (./neck.ts). Fixed in
 * size; the summary scrolls inside it. It never takes keyboard focus. The pill's gear swaps in the
 * log's settings, and its star and checkmark close it, so it has no close button.
 */
export const LoggingOverlay = () => {
  const now = useAtomValue(loggingOverlayAtom);
  const state = AsyncResult.isSuccess(now) ? now.value : closedLoggingOverlay;
  const summary = useAtomValue(summaryAtom);
  const panel = useRef<HTMLElement>(null);
  const neckRef = useRef<SVGSVGElement>(null);
  useClickThrough();
  useGrow(panel, neckRef, state);
  const joint =
    state.join === null ? null : neck(state.join, { width: innerWidth, height: innerHeight });

  return (
    <div className="relative h-screen w-screen">
      <section
        ref={panel}
        data-overlay-hit
        className="absolute flex flex-col overflow-hidden text-[13px] text-zinc-200 antialiased shadow-[0_12px_28px_rgb(0_0_0/0.4),0_2px_6px_rgb(0_0_0/0.25)]"
        style={{ inset: overlayMargin, borderRadius: panelRadius, background: liquidColor }}
      >
        <Header
          title={state.panel === "summary" ? "Oppsummering" : "Innstillinger for loggen"}
          target={state.target}
        />
        {state.panel === "summary" ? (
          <Summary summary={AsyncResult.isSuccess(summary) ? summary.value : null} />
        ) : (
          <LogSettings />
        )}
      </section>
      {/*
        Over the panel, so the panel's shadow doesn't darken the flares. They cast none of their
        own: it would fall across the panel's side.
      */}
      {joint !== null && (
        <svg ref={neckRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          <path
            data-overlay-hit
            className="pointer-events-auto"
            d={joint.d}
            transform={joint.transform}
            fill={liquidColor}
          />
        </svg>
      )}
    </div>
  );
};
