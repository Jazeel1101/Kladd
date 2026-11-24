import { assert, describe, it } from "vite-plus/test";
import { parseClipAnswer } from "./SessionCaptureDarwin";

describe("parseClipAnswer", () => {
  it("reads the session helper's clip answers", () => {
    assert.deepStrictEqual(parseClipAnswer("clip-recording"), { _tag: "Recording" });
    assert.deepStrictEqual(parseClipAnswer("clip-stopped"), { _tag: "Stopped" });
    assert.deepStrictEqual(parseClipAnswer("clip-failed no display to capture"), {
      _tag: "Failed",
      reason: "no display to capture",
    });
  });

  it("ignores anything else", () => {
    assert.isNull(parseClipAnswer("recording"));
    assert.isNull(parseClipAnswer("clip-failed"));
  });
});
