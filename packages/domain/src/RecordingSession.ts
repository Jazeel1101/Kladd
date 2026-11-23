import { DateTime, Duration, Schema } from "effect";

/** Identifies one recording session. Branded so it cannot be mixed up with other string IDs. */
export const RecordingSessionId = Schema.String.pipe(Schema.brand("RecordingSessionId"));
export type RecordingSessionId = typeof RecordingSessionId.Type;

/** A period where Kladd records what the user does (GLOSSARY: "opptak"). */
export class RecordingSession extends Schema.Class<
  RecordingSession,
  { readonly brand: unique symbol }
>("RecordingSession")({
  id: RecordingSessionId,
  startedAt: Schema.DateTimeUtc,
}) {}

/** Pure logic lives next to the schema it is about. No services, no side effects. */
export const elapsed = (session: RecordingSession, now: DateTime.Utc): Duration.Duration =>
  DateTime.distance(session.startedAt, now);

export class RecordingAlreadyActive extends Schema.TaggedError<
  RecordingAlreadyActive,
  { readonly brand: unique symbol }
>()("RecordingAlreadyActive", { activeSessionId: RecordingSessionId }) {}

export class ScreenCapturePermissionDenied extends Schema.TaggedError<
  ScreenCapturePermissionDenied,
  { readonly brand: unique symbol }
>()("ScreenCapturePermissionDenied", {}) {}

export class NoActiveRecording extends Schema.TaggedError<
  NoActiveRecording,
  { readonly brand: unique symbol }
>()("NoActiveRecording", {}) {}
