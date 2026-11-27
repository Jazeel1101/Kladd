import { assert, describe, it } from "@effect/vitest";
import { emptyFocus } from "@kladd/domain";
import { Generic } from "./Generic";

const app = { bundleId: "com.apple.TextEdit", name: "TextEdit" };

describe("Generic", () => {
  it("reports the app name and window title as the writing target", () => {
    assert.deepStrictEqual(Generic.target({ ...emptyFocus, app, title: "Uke 3.rtf" }), {
      app: "TextEdit",
      document: "Uke 3.rtf",
    });
    assert.deepStrictEqual(Generic.target(emptyFocus), { app: null, document: null });
  });
});
