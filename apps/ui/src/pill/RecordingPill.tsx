import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { elapsed } from "@kladd/domain";
import { DateTime, Duration } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { recordingAtom } from "../recording/atoms";
import { showWindowAtom } from "../windows/atoms";
import { openMenuAtom } from "./atoms";

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

/** RecordingPill: Kladd's only presence. Click opens the expanded view; right-click or ⋯ opens the menu. */
export const RecordingPill = () => {
  const recording = useAtomValue(recordingAtom);
  const showWindow = useAtomSet(showWindowAtom);
  const openMenu = useAtomSet(openMenuAtom);
  const session = AsyncResult.isSuccess(recording) ? recording.value : null;
  const now = useNow(session !== null);

  const menu = () => openMenu({ payload: undefined });

  return (
    <div
      className="flex h-screen w-screen items-center gap-2 rounded-full bg-neutral-900/90 px-3 text-sm text-white select-none"
      onContextMenu={(event) => {
        event.preventDefault();
        menu();
      }}
    >
      <Button
        className="flex flex-1 items-center gap-2 border-0 bg-transparent p-0 text-white"
        onClick={() => showWindow({ payload: { kind: "expanded" } })}
      >
        <span
          className={cn(
            "size-2 rounded-full",
            session === null ? "bg-neutral-500" : "animate-pulse bg-red-500",
          )}
        />
        <span className="tabular-nums">
          {session === null ? "Kladd" : formatElapsed(elapsed(session, now))}
        </span>
      </Button>
      <Button
        aria-label="Menu"
        className="border-0 bg-transparent px-1 text-neutral-400"
        onClick={menu}
      >
        ⋯
      </Button>
    </div>
  );
};
