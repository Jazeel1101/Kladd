import { assert, describe, it } from "@effect/vitest";
import { emptyFocus } from "@kladd/domain";
import { OneNote } from "./OneNote";

const app = { bundleId: "com.microsoft.onenote.mac", name: "Microsoft OneNote" };
const window = { x: 0, y: 25, width: 1200, height: 800 };
const element = { x: 300, y: 120, width: 700, height: 600 };
const caret = { x: 420, y: 300, width: 1, height: 16 };

describe("OneNote", () => {
  it("anchors to the page element even when a caret is reported", () => {
    assert.deepStrictEqual(OneNote.anchor({ ...emptyFocus, app, window, element, caret }), element);
  });

  it("falls back to the window when no element is focused", () => {
    assert.deepStrictEqual(OneNote.anchor({ ...emptyFocus, app, window }), window);
  });
});
