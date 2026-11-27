import {
  type CaptureMode,
  NoActiveSession,
  NoEndedSession,
  type OverviewInput,
  type PastSession,
  type ScreenCaptureFailed,
  type ScreenCapturePermissionDenied,
  Screenshot,
  Session,
  SessionAlreadyOpen,
  type SessionId,
  autoEndAt,
  endSession,
  isEmptySession,
  logSession,
  sessionState,
  type SummaryStatus,
} from "@kladd/domain";
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { requireScreenCapture } from "../capture/requireScreenCapture";
import { askForAccessibility } from "../focus/askForAccessibility";
import { LoggingOverlay } from "../logging/LoggingOverlay";
import { FocusTracker } from "../ports/FocusTracker";
import { Ids } from "../ports/Ids";
import { ScreenCapture } from "../ports/ScreenCapture";
import { SessionCapture, type SessionCaptureHandle } from "../ports/SessionCapture";
import { SessionStore, type StoredSession } from "../ports/SessionStore";
import { SummaryAgent } from "../ports/SummaryAgent";
import { Transcriber } from "../ports/Transcriber";
import { Screenshots } from "../screenshot/Screenshots";
import { Clips } from "./Clips";
import { finishSession } from "./finishSession";

/** The capture of the active session. */
interface Running {
  readonly handle: SessionCaptureHandle;
  readonly scope: Scope.Closeable;
}

/** When the student captured something: screenshots taken, clips started and stopped. */
const capturesIn = (input: OverviewInput): ReadonlyArray<DateTime.Utc> => [
  ...input.screenshots.map((shot) => shot.takenAt),
  ...input.clips.flatMap(({ info }) =>
    info.stoppedAt === null ? [info.startedAt] : [info.startedAt, info.stoppedAt],
  ),
];

/** How often a session waiting to end by itself checks it is still the active one. */
const autoEndCheck = Duration.minutes(1);

/**
 * Use case: start and end work sessions (GLOSSARY: "økt"), and finish their logging. The pill has a
 * state for each: no open session (start one), an active one (screenshots and clips go into its
 * folder through Screenshots and Clips), and an ended one (logging mode, GLOSSARY: "loggemodus").
 * Ending opens the logging overlay; the pill's checkmark then marks the session logged. A session
 * that ends holding nothing (isEmptySession) is discarded instead: its folder goes, and the pill
 * is idle again.
 * The session folder is the only record of a session, so an open session survives quitting: an
 * active manual one is resumed at launch, and one past autoEndAt ends then, without the overlay.
 * An ended folder left unfinished, such as by a crash or by an end before the model was ready, is
 * finished when Kladd opens and once the model is ready, when the active session's stopped clips
 * are transcribed too.
 * A use case depends on ports (../ports) and other use cases, never on infra or platform code.
 */
export class Sessions extends Context.Service<
  Sessions,
  {
    /**
     * Asks for screen capture permission first if Kladd doesn't have it, then starts a session in
     * `mode` and its capture. Once started, asks for Accessibility in the background (optional: it
     * places the logging overlay and tells which app a screenshot shows). Fails, leaving no session,
     * if the capture can't start.
     */
    readonly start: (
      mode: CaptureMode,
    ) => Effect.Effect<
      Session,
      SessionAlreadyOpen | ScreenCapturePermissionDenied | ScreenCaptureFailed
    >;
    /**
     * Stops the active session's clip, then its capture, and opens the logging overlay. Always
     * ends: a capture that fails to finish is logged, and the folder is finished from what it wrote.
     * Succeeds with the ended session, or none when it held nothing and was discarded.
     */
    readonly end: Effect.Effect<Option.Option<Session>, NoActiveSession>;
    /** The pill's checkmark: the ended session's log is written. Closes the logging overlay. */
    readonly finishLogging: Effect.Effect<Session, NoEndedSession>;
    /** The open session: active, or ended and waiting for its log. */
    readonly current: Effect.Effect<Option.Option<Session>>;
    /** The open session now, then on every start, end and finished log. */
    readonly changes: Stream.Stream<Option.Option<Session>>;
    /** Every session that is not active, newest first, then again on every change. */
    readonly past: Stream.Stream<ReadonlyArray<PastSession>>;
    /**
     * The ended session's summary, as its folder is finished: being written, written or failed.
     * Null without an ended session. Now, then every change.
     */
    readonly summary: Stream.Stream<SummaryStatus | null>;
  }
>()("kladd/core/Sessions") {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const screenCapture = yield* ScreenCapture;
      const sessionCapture = yield* SessionCapture;
      const transcriber = yield* Transcriber;
      const summaryAgent = yield* SummaryAgent;
      const clips = yield* Clips;
      const screenshots = yield* Screenshots;
      const focus = yield* FocusTracker;
      const store = yield* SessionStore;
      const ids = yield* Ids;
      const logging = yield* LoggingOverlay;
      const open = yield* SubscriptionRef.make(Option.none<StoredSession>());
      // The ended session's folder and how far its summary is; null without an ended session.
      const summary = yield* SubscriptionRef.make<{
        readonly folder: string;
        readonly status: SummaryStatus;
      } | null>(null);
      const writing = { _tag: "Writing" } as const;
      // What finishing left in the folder: a summary, or none, as the agent failed.
      const summarized = (folder: string) =>
        Effect.map(
          store.summary(folder),
          Option.match({
            onNone: (): SummaryStatus => ({ _tag: "Failed" }),
            onSome: (text): SummaryStatus => ({ _tag: "Written", text }),
          }),
        );
      const running = yield* Ref.make(Option.none<Running>());
      // Start, end and finishLogging check, then change, the open session; one at a time.
      const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));
      // The Accessibility prompt and the wait for autoEndAt outlive start; only one prompt at a time.
      const layerScope = yield* Effect.scope;
      const asking = yield* Semaphore.make(1);

      // One folder is finished at a time, and the check for unfinished folders looks at each only
      // once it may run: a session ended at launch is then finished, and summarized, once.
      const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));
      const finish = (folder: string) =>
        finishSession(folder).pipe(
          Effect.provideService(SessionStore, store),
          Effect.provideService(Clips, clips),
          Effect.provideService(SummaryAgent, summaryAgent),
          Effect.ignoreCause({ log: "Warn", message: "Could not finish the session folder" }),
          Effect.andThen(
            Effect.gen(function* () {
              if ((yield* SubscriptionRef.get(summary))?.folder !== folder) return;
              const status = yield* summarized(folder);
              // Logging may have closed it meanwhile.
              yield* SubscriptionRef.update(summary, (now) =>
                now?.folder === folder ? { folder, status } : now,
              );
            }),
          ),
        );

      // Transcription, overview and summary outlive end, and never fail it: their failures are logged.
      const finishInBackground = (folder: string) =>
        finish(folder).pipe(oneAtATime, Effect.forkIn(layerScope));

      // Nothing marks a folder finished but its files, so a crash or quit before finishSession
      // leaves it to the next launch. Each runs once per launch: one that keeps failing waits for the next.
      const finishUnfinished = Effect.fn("Sessions.finishUnfinished")(function* (
        needsModel: boolean,
      ) {
        for (const { folder, session } of yield* store.list) {
          // The active session's overview waits for its end, but its stopped clips needn't wait
          // for their transcripts.
          if (sessionState(session) === "active") {
            if (needsModel) yield* clips.transcribe(folder);
            continue;
          }
          yield* Effect.gen(function* () {
            if (yield* store.finished(folder)) return;
            if ((yield* store.untranscribed(folder)).length > 0 !== needsModel) return;
            yield* finish(folder);
          }).pipe(oneAtATime);
        }
      });

      // Ends `session`, or discards it when it holds nothing. Its capture has stopped.
      const close = Effect.fn("Sessions.close")(function* (
        { folder, session }: StoredSession,
        at: DateTime.Utc,
      ) {
        if (isEmptySession(yield* store.read(folder))) {
          yield* store.remove(folder);
          yield* SubscriptionRef.set(open, Option.none());
          yield* screenshots.clear;
          return Option.none<Session>();
        }
        const ended = endSession(session, at);
        yield* store.update(folder, ended);
        yield* SubscriptionRef.set(summary, { folder, status: writing });
        yield* SubscriptionRef.set(open, Option.some({ folder, session: ended }));
        yield* screenshots.begin(session.id, folder);
        yield* screenshots.end;
        yield* finishInBackground(folder);
        return Option.some(ended);
      });

      // Ends the open session if it is `id` and still active, at `at` or now.
      const endOpen = (
        id: SessionId | null,
        at: DateTime.Utc | null,
      ): Effect.Effect<Option.Option<Session>, NoActiveSession> =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(open);
          if (
            Option.isNone(current) ||
            sessionState(current.value.session) !== "active" ||
            (id !== null && current.value.session.id !== id)
          ) {
            return yield* new NoActiveSession({});
          }
          yield* clips.end;
          yield* screenshots.end;
          // Before the end is saved: until then finishUnfinished leaves the folder alone.
          const capturing = yield* Ref.getAndSet(running, Option.none());
          if (Option.isSome(capturing)) {
            const { handle, scope } = capturing.value;
            yield* handle.stop.pipe(
              Effect.catchTag("ScreenCaptureFailed", (error) =>
                Effect.logWarning("The session capture did not stop cleanly", error.reason),
              ),
            );
            yield* Scope.close(scope, Exit.void);
          }
          return yield* close(current.value, at ?? (yield* DateTime.now));
        }).pipe(exclusive);

      // Waits until the session is past autoEndAt, re-reading its captures only when it might be:
      // a capture can only move the end later. Sleeps a minute at a time, so a Mac that slept
      // through the end still ends the session soon after it wakes.
      const endWhenDue = Effect.fn("Sessions.endWhenDue")(function* (
        session: Session,
        folder: string,
      ) {
        const stillActive = Effect.map(SubscriptionRef.get(open), (current) =>
          Option.exists(
            current,
            (o) => o.session.id === session.id && sessionState(o.session) === "active",
          ),
        );
        const dueNow = Effect.map(store.read(folder), (input) =>
          autoEndAt(session, capturesIn(input)),
        );
        let due = yield* dueNow;
        while (yield* stillActive) {
          const now = yield* DateTime.now;
          if (DateTime.isLessThan(now, due)) {
            yield* Effect.sleep(Duration.min(DateTime.distance(now, due), autoEndCheck));
            continue;
          }
          due = yield* dueNow;
          if (DateTime.isLessThan(now, due)) continue;
          yield* endOpen(session.id, due).pipe(Effect.ignore);
          return;
        }
      });

      // Screenshots and clips go into the folder from now on. Never fails, so a session whose
      // capture could not resume stays open: screenshots then fall back to their own capture.
      const openActive = Effect.fn("Sessions.openActive")(function* (
        session: Session,
        folder: string,
      ) {
        yield* clips.begin(folder);
        yield* screenshots.begin(session.id, folder);
        yield* SubscriptionRef.set(open, Option.some({ folder, session }));
        yield* endWhenDue(session, folder).pipe(Effect.forkIn(layerScope));
      });

      const startCapture = Effect.fn("Sessions.startCapture")(function* (
        session: Session,
        folder: string,
      ) {
        const scope = yield* Scope.make();
        const handle = yield* sessionCapture.start(folder, session.mode).pipe(
          Scope.provide(scope),
          Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
        );
        yield* Ref.set(running, Option.some({ handle, scope }));
      });

      // The newest session not logged yet is the open one; there is never more than one.
      const unlogged = (yield* store.list).find(
        ({ session }) => sessionState(session) !== "logged",
      );
      if (unlogged !== undefined) {
        const { folder, session } = unlogged;
        const now = yield* DateTime.now;
        const due = autoEndAt(session, capturesIn(yield* store.read(folder)));
        if (sessionState(session) !== "active") {
          // Without its summary.md, finishUnfinished writes it below, or finished without one.
          const written = yield* store.summary(folder);
          const status: SummaryStatus = Option.isSome(written)
            ? { _tag: "Written", text: written.value }
            : (yield* store.finished(folder))
              ? { _tag: "Failed" }
              : writing;
          yield* SubscriptionRef.set(summary, { folder, status });
          yield* SubscriptionRef.set(open, Option.some(unlogged));
          yield* screenshots.begin(session.id, folder);
          yield* screenshots.end;
        } else if (session.mode === "auto" || DateTime.isGreaterThanOrEqualTo(now, due)) {
          // A resumed auto capture would start its timeline's clock again, so it ends instead.
          yield* close(unlogged, DateTime.min(now, due));
        } else {
          yield* startCapture(session, folder).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not resume the session capture", error),
            ),
          );
          yield* openActive(session, folder);
        }
      }
      yield* finishUnfinished(false).pipe(Effect.forkIn(layerScope));

      // Downloads the Whisper model if it is missing, then transcribes what was saved without it.
      yield* transcriber.prepare.pipe(
        Effect.andThen(finishUnfinished(true)),
        Effect.ignoreCause({ log: "Warn", message: "Could not prepare transcription" }),
        Effect.forkIn(layerScope),
      );

      const start = Effect.fn("Sessions.start")(function* (mode: CaptureMode) {
        const current = yield* SubscriptionRef.get(open);
        if (Option.isSome(current)) {
          return yield* new SessionAlreadyOpen({ sessionId: current.value.session.id });
        }
        // Inside the permit, so a second start waits for this one's permission prompt.
        yield* requireScreenCapture.pipe(Effect.provideService(ScreenCapture, screenCapture));
        const session = new Session({
          id: yield* ids.sessionId,
          mode,
          startedAt: yield* DateTime.now,
          endedAt: null,
          loggedAt: null,
        });
        const folder = yield* store.create(session);
        // A session that never captured is no session: nothing may look open.
        yield* startCapture(session, folder).pipe(Effect.onError(() => store.remove(folder)));
        yield* openActive(session, folder);
        yield* askForAccessibility.pipe(
          Effect.provideService(FocusTracker, focus),
          Semaphore.withPermitsIfAvailable(asking, 1),
          Effect.forkIn(layerScope),
        );
        return session;
      }, exclusive);

      const end = Effect.gen(function* () {
        const ended = yield* endOpen(null, null);
        if (Option.isSome(ended)) yield* logging.open;
        return ended;
      }).pipe(Effect.withSpan("Sessions.end"));

      const finishLogging = Effect.gen(function* () {
        const logged = yield* Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(open);
          if (Option.isNone(current) || sessionState(current.value.session) !== "ended") {
            return yield* new NoEndedSession({});
          }
          const { folder, session } = current.value;
          const logged = logSession(session, yield* DateTime.now);
          yield* store.update(folder, logged);
          yield* SubscriptionRef.set(summary, null);
          yield* SubscriptionRef.set(open, Option.none());
          yield* screenshots.clear;
          return logged;
        }).pipe(exclusive);
        yield* logging.close;
        return logged;
      }).pipe(Effect.withSpan("Sessions.finishLogging"));

      const pastSessions = Effect.gen(function* () {
        const found: Array<PastSession> = [];
        for (const { folder, session } of yield* store.list) {
          if (sessionState(session) === "active") continue;
          const input = yield* store.read(folder);
          found.push({
            session,
            screenshots: input.screenshots.map(
              ({ id, takenAt, display }) =>
                new Screenshot({ id, session: session.id, takenAt, display }),
            ),
            clips: input.clips.length,
          });
        }
        return found;
      }).pipe(Effect.withSpan("Sessions.past"));

      const changes = SubscriptionRef.changes(open).pipe(
        Stream.map(Option.map(({ session }) => session)),
      );

      return Sessions.of({
        start,
        end,
        finishLogging,
        current: Effect.map(
          SubscriptionRef.get(open),
          Option.map(({ session }) => session),
        ),
        changes,
        past: Stream.mapEffect(changes, () => pastSessions),
        summary: SubscriptionRef.changes(summary).pipe(Stream.map((now) => now?.status ?? null)),
      });
    }),
  );
}
