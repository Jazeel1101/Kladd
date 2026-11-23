import { useAtomSet } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { hideWindowAtom } from "../windowAtoms";

/** ExpandedView: summary and images of a recording, opened from the pill. */
export const ExpandedView = () => {
  const hideWindow = useAtomSet(hideWindowAtom);
  return (
    <section className="flex h-screen flex-col gap-3 rounded-xl bg-white/95 p-6 text-sm shadow-lg">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-medium">Oppsummering</h1>
        <Button
          aria-label="Close"
          className="border-0 bg-transparent text-neutral-500"
          onClick={() => hideWindow({ payload: { kind: "expanded" } })}
        >
          ✕
        </Button>
      </header>
      <p className="text-neutral-600">Oppsummering og bilder kommer her.</p>
    </section>
  );
};
