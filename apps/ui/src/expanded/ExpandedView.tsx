import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@ui-sdk/react/button";
import { screenshotUrl } from "@kladd/contract";
import { type PastSession, elapsed, sessionState } from "@kladd/domain";
import { DateTime, Duration } from "effect";
import { AsyncResult } from "effect/reactivity";
import { pastSessionsAtom } from "../session/atoms";
import { hideWindowAtom } from "../windows/atoms";

const when = new Intl.DateTimeFormat("nb-NO", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "1 t 25 min", or "12 min". */
const length = (session: PastSession["session"]): string => {
  const minutes = Math.round(Duration.toMinutes(elapsed(session, session.startedAt)));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} t ${minutes % 60} min` : `${minutes} min`;
};

/** How many screenshots a row shows; the rest are counted. */
const shown = 4;

const SessionRow = ({ past }: { readonly past: PastSession }) => {
  const { session, screenshots, clips } = past;
  const counts = [
    `${screenshots.length} skjermbilde${screenshots.length === 1 ? "" : "r"}`,
    `${clips} klipp`,
  ].join(" · ");
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-neutral-800">
          {when.format(DateTime.toDateUtc(session.startedAt))}
        </p>
        <p className="text-xs text-neutral-500">
          {sessionState(session) === "logged" ? "Logget" : "Venter på logg"}
        </p>
      </div>
      <p className="text-xs text-neutral-500">
        {length(session)} · {counts}
      </p>
      {screenshots.length > 0 && (
        <div className="flex items-center gap-2">
          {screenshots.slice(0, shown).map((shot) => (
            <img
              key={shot.id}
              src={screenshotUrl(shot)}
              alt=""
              loading="lazy"
              className="h-12 rounded border border-neutral-200 object-cover"
              style={{ aspectRatio: `${shot.display.width} / ${shot.display.height}` }}
            />
          ))}
          {screenshots.length > shown && (
            <span className="text-xs text-neutral-500">+{screenshots.length - shown}</span>
          )}
        </div>
      )}
    </li>
  );
};

/** ExpandedView: the ended sessions, newest first, opened from the pill menu. */
export const ExpandedView = () => {
  const hideWindow = useAtomSet(hideWindowAtom);
  const result = useAtomValue(pastSessionsAtom);
  const past = AsyncResult.isSuccess(result) ? result.value : [];
  return (
    <section className="flex h-screen flex-col gap-3 rounded-xl bg-white/95 p-6 text-sm shadow-lg">
      <header className="flex items-center justify-between">
        <h1 className="text-base font-medium">Tidligere økter</h1>
        <Button
          aria-label="Close"
          className="border-0 bg-transparent text-neutral-500"
          onClick={() => hideWindow({ payload: { kind: "expanded" } })}
        >
          ✕
        </Button>
      </header>
      {past.length === 0 ? (
        <p className="text-neutral-600">Ingen tidligere økter ennå.</p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {past.map((p) => (
            <SessionRow key={p.session.id} past={p} />
          ))}
        </ul>
      )}
    </section>
  );
};
