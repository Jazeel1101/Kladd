import { assert, describe, it } from "@effect/vitest";
import { DateTime } from "effect";
import { RecordingSessionId } from "./RecordingSession";
import { isSessionFolderOf, sessionFolderName } from "./SessionFolderName";

const id = RecordingSessionId.make("019a-abc");

describe("sessionFolderName", () => {
  it("names the folder after the local start time and the id", () => {
    const startedAt = DateTime.makeZonedUnsafe("2026-11-24T13:02:59Z", { timeZone: "Europe/Oslo" });
    assert.strictEqual(sessionFolderName(id, startedAt), "2026-11-24_1402_019a-abc");
  });

  it("is found again by its id alone", () => {
    assert.strictEqual(isSessionFolderOf("2026-11-24_1402_019a-abc", id), true);
    assert.strictEqual(isSessionFolderOf("2026-11-24_1402_019a-abcd", id), false);
  });
});
