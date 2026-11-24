import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import type { LoggingOverlayInfo } from "@kladd/domain";
import { AsyncResult } from "effect/reactivity";
import { hideWindowAtom } from "../windows/atoms";
import { loggingOverlayAtom } from "./atoms";

/** Where the user writes, as the app adapter reported it: "OneNote · Uke 3". */
const WritingTarget = ({ info }: { info: LoggingOverlayInfo }) => {
  const { app, document } = info.target;
  const parts = [app, document].filter((part) => part !== null);
  return (
    <div className="flex flex-col gap-1">
      <p className="truncate font-medium text-neutral-800">
        {parts.length === 0 ? "Ukjent app" : parts.join(" · ")}
      </p>
      <p className="text-xs text-neutral-500">
        {info.adapter} · {info.anchored ? "ved teksten" : "ingen tekst funnet"}
      </p>
    </div>
  );
};

/**
 * LoggingOverlay: sits next to where the user writes their log and opens when a recording stops.
 * The composer goes here; its design is not decided yet.
 */
export const LoggingOverlay = () => {
  const hideWindow = useAtomSet(hideWindowAtom);
  const opened = useAtomValue(loggingOverlayAtom);
  const info = AsyncResult.isSuccess(opened) ? opened.value : null;
  return (
    <section className="flex h-screen flex-col gap-3 rounded-xl bg-white/95 p-4 text-sm shadow-lg">
      <header className="flex items-center justify-between">
        <h1 className="font-medium">Skriv logg</h1>
        <Button
          aria-label="Close"
          className="border-0 bg-transparent text-neutral-500"
          onClick={() => hideWindow({ payload: { kind: "logging" } })}
        >
          ✕
        </Button>
      </header>
      {info !== null && <WritingTarget info={info} />}
      <p className="text-neutral-600">Composer kommer her.</p>
    </section>
  );
};
