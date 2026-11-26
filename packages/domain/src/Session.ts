import { DateTime, Duration, Schema } from "effect";

/** Identifies one work session. Branded so it cannot be mixed up with other string IDs. */
export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

/**
 * What a session captures (GLOSSARY: "opptaksmodus"), chosen before it starts. `manual`: only the
 * screenshots and clips the student takes. `auto`: keyframes of the screen too; not offered yet.
 */
export const CaptureMode = Schema.Literals(["manual", "auto"]);
export type CaptureMode = typeof CaptureMode.Type;

/**
 * A work period the student writes one section of their log about (GLOSSARY: "økt"), with
 * everything captured in it. Started and ended from the pill; see sessionState.
 */
export class Session extends Schema.Class<Session, { readonly brand: unique symbol }>("Session")({
  id: SessionId,
  mode: CaptureMode,
  startedAt: Schema.DateTimeUtc,
  /** Null while active. */
  endedAt: Schema.NullOr(Schema.DateTimeUtc),
  /** Set by the pill's checkmark once the student has written its log. */
  loggedAt: Schema.NullOr(Schema.DateTimeUtc),
}) {}

/**
 * `active`: capturing. `ended`: the pill is in logging mode (GLOSSARY: "loggemodus") until its
 * checkmark makes the session `logged`.
 */
export type SessionState = "active" | "ended" | "logged";

/** Pure logic lives next to the schema it is about. No services, no side effects. */
export const sessionState = (session: Session): SessionState =>
  session.loggedAt !== null ? "logged" : session.endedAt !== null ? "ended" : "active";

/** The session, ended at `at`. */
export const endSession = (session: Session, at: DateTime.Utc): Session =>
  new Session({ ...fieldsOf(session), endedAt: at });

/** The ended session, its log written at `at`. */
export const logSession = (session: Session, at: DateTime.Utc): Session =>
  new Session({ ...fieldsOf(session), loggedAt: at });

/** A session's fields as a plain object, which, unlike the instance, can be spread. */
export const fieldsOf = ({ id, mode, startedAt, endedAt, loggedAt }: Session) => ({
  id,
  mode,
  startedAt,
  endedAt,
  loggedAt,
});

export const elapsed = (session: Session, now: DateTime.Utc): Duration.Duration =>
  DateTime.distance(session.startedAt, session.endedAt ?? now);

/** A session runs at least this long before it ends by itself, */
export const sessionLength = Duration.hours(8);
/** and never sooner than this after its last capture. */
export const captureGrace = Duration.hours(1);

/**
 * When an active session ends by itself: `sessionLength` after it started, or `captureGrace`
 * after the last of `captures` (when screenshots were taken and clips started or stopped), whichever
 * is later.
 */
export const autoEndAt = (session: Session, captures: ReadonlyArray<DateTime.Utc>): DateTime.Utc =>
  captures.reduce(
    (end, at) => DateTime.max(end, DateTime.addDuration(at, captureGrace)),
    DateTime.addDuration(session.startedAt, sessionLength),
  );

/** A session is active or waiting for its log, so another can't start. */
export class SessionAlreadyOpen extends Schema.TaggedError<
  SessionAlreadyOpen,
  { readonly brand: unique symbol }
>()("SessionAlreadyOpen", { sessionId: SessionId }) {}

export class NoActiveSession extends Schema.TaggedError<
  NoActiveSession,
  { readonly brand: unique symbol }
>()("NoActiveSession", {}) {}

/** No session is waiting for its log: the pill is not in logging mode. */
export class NoEndedSession extends Schema.TaggedError<
  NoEndedSession,
  { readonly brand: unique symbol }
>()("NoEndedSession", {}) {}
