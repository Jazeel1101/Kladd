import { assert, describe, it } from "@effect/vitest";
import { emptyFocus } from "@kladd/domain";
import { Generic } from "./Generic";

const app = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
const window = { x: 0, y: 25, width: 1200, height: 800 };
const element = { x: 20, y: 60, width: 1160, height: 740 };
const caret = { x: 420, y: 300, width: 1, height: 16 };

describe("Generic", () => {
  it("anchors to the caret, else the element, else the window", () => {
    assert.deepStrictEqual(Generic.anchor({ ...emptyFocus, window, element, caret }), caret);
    assert.deepStrictEqual(Generic.anchor({ ...emptyFocus, window, element }), element);
    assert.deepStrictEqual(Generic.anchor({ ...emptyFocus, window }), window);
    assert.isNull(Generic.anchor(emptyFocus));
  });

  it("reports the app name and window title as the writing target", () => {
    assert.deepStrictEqual(Generic.target({ ...emptyFocus, app, title: "Uke 3.rtf" }), {
      app: "TextEdit",
      document: "Uke 3.rtf",
    });
    assert.deepStrictEqual(Generic.target(emptyFocus), { app: null, document: null });
  });
});
