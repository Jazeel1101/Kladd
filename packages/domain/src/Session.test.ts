import { assert, describe, it } from "@effect/vitest";
import { DateTime, Duration } from "effect";
import {
  Session,
  SessionId,
  autoEndAt,
  elapsed,
  endSession,
  logSession,
  sessionState,
} from "./Session";

const at = (iso: string) => DateTime.makeUnsafe(iso);

const session = new Session({
  id: SessionId.make("session-1"),
  mode: "manual",
  startedAt: at("2026-01-01T08:00:00Z"),
  endedAt: null,
  loggedAt: null,
});

describe("elapsed", () => {
  it("measures time since the session started, until it ended", () => {
    const now = at("2026-01-01T08:05:00Z");
    assert.isTrue(Duration.equals(elapsed(session, now), Duration.minutes(5)));
    const ended = endSession(session, at("2026-01-01T08:02:00Z"));
    assert.isTrue(Duration.equals(elapsed(ended, now), Duration.minutes(2)));
  });
});

describe("sessionState", () => {
  it("is active, then ended, then logged", () => {
    assert.strictEqual(sessionState(session), "active");
    const ended = endSession(session, at("2026-01-01T09:00:00Z"));
    assert.strictEqual(sessionState(ended), "ended");
    const logged = logSession(ended, at("2026-01-01T09:10:00Z"));
    assert.strictEqual(sessionState(logged), "logged");
  });
});

describe("autoEndAt", () => {
  it("is 8 hours after the start without captures", () => {
    assert.deepStrictEqual(autoEndAt(session, []), at("2026-01-01T16:00:00Z"));
  });

  it("is 8 hours after the start when the last capture was more than an hour before", () => {
    assert.deepStrictEqual(
      autoEndAt(session, [at("2026-01-01T09:00:00Z"), at("2026-01-01T14:59:00Z")]),
      at("2026-01-01T16:00:00Z"),
    );
  });

  it("is an hour after a later capture, whatever order the captures come in", () => {
    assert.deepStrictEqual(
      autoEndAt(session, [at("2026-01-01T16:30:00Z"), at("2026-01-01T09:00:00Z")]),
      at("2026-01-01T17:30:00Z"),
    );
  });
});
