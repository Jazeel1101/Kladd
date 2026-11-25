import { assert, describe, it } from "vite-plus/test";
import { parseSessionAnswer } from "./SessionCaptureDarwin";

describe("parseSessionAnswer", () => {
  it("reads the session helper's clip answers", () => {
    assert.deepStrictEqual(parseSessionAnswer("clip-recording"), { _tag: "ClipRecording" });
    assert.deepStrictEqual(parseSessionAnswer("clip-stopped"), { _tag: "ClipStopped" });
    assert.deepStrictEqual(parseSessionAnswer("clip-failed no display to capture"), {
      _tag: "ClipFailed",
      reason: "no display to capture",
    });
  });

  it("reads screenshot answers, paths with spaces included", () => {
    assert.deepStrictEqual(parseSessionAnswer("screenshot-saved /tmp/a b/shot.png"), {
      _tag: "ScreenshotSaved",
      file: "/tmp/a b/shot.png",
    });
    assert.deepStrictEqual(parseSessionAnswer("screenshot-failed /tmp/shot.png"), {
      _tag: "ScreenshotFailed",
      file: "/tmp/shot.png",
    });
  });

  it("ignores anything else", () => {
    assert.isNull(parseSessionAnswer("recording"));
    assert.isNull(parseSessionAnswer("clip-failed"));
    assert.isNull(parseSessionAnswer("clip-failed "));
    assert.isNull(parseSessionAnswer("screenshot-saved"));
  });
});
