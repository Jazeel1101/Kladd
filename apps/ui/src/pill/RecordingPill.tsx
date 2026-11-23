import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { recordingAtom } from "../recording/atoms";
import { KladdClient } from "../rpc";
import { showWindowAtom } from "../windowAtoms";

const openMenuAtom = KladdClient.mutation("OpenPillMenu");

const formatElapsed = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

/** Re-renders every second while `active`. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
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
          {session === null
            ? "Kladd"
            : formatElapsed(now - DateTime.toEpochMillis(session.startedAt))}
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
