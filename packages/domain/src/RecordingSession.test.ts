import { assert, describe, it } from "@effect/vitest";
import { DateTime, Duration } from "effect";
import { RecordingSession, RecordingSessionId, elapsed } from "./RecordingSession";

describe("elapsed", () => {
  it("measures time since the session started", () => {
    const session = new RecordingSession({
      id: RecordingSessionId.make("session-1"),
      startedAt: DateTime.makeUnsafe("2026-01-01T10:00:00Z"),
    });
    const now = DateTime.makeUnsafe("2026-01-01T10:05:00Z");
    assert.isTrue(Duration.equals(elapsed(session, now), Duration.minutes(5)));
  });
});
