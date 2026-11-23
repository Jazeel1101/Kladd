import { useAtomSet } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { hideWindowAtom } from "../windowAtoms";

/**
 * LoggingOverlay: sits next to where the user writes their log and opens when a recording stops.
 * The composer goes here; its design is not decided yet.
 */
export const LoggingOverlay = () => {
  const hideWindow = useAtomSet(hideWindowAtom);
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
      <p className="text-neutral-600">Composer kommer her.</p>
    </section>
  );
};
