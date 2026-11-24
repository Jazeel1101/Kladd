import { assert, describe, it } from "@effect/vitest";
import { emptyFocus, placeInside, type FocusSnapshot } from "@kladd/domain";
import { OneNote } from "./OneNote";

// A real snapshot (`kladd-capture focus`) of OneNote 16 with the section and page lists open.
const snapshot: FocusSnapshot = {
  app: { bundleId: "com.microsoft.onenote.mac", name: "Microsoft OneNote" },
  window: { x: 84, y: 33, width: 1366, height: 903 },
  title: "2IT 2026-2027 💻 Notatblokk",
  element: { x: 478, y: 181, width: 972, height: 755 },
  caret: null,
  selection: [
    { id: "ONMUXSectionItemView", text: "Python" },
    { id: "ONMUXPageItemView", text: "Python-kurs" },
  ],
};
const screen = { x: 0, y: 33, width: 1470, height: 923 };
const overlay = { width: 360, height: 480 };

describe("OneNote", () => {
  it("places the overlay inside the page canvas, clear of the lists and the scroll bar", () => {
    const anchor = OneNote.anchor(snapshot);
    assert.deepStrictEqual(anchor, { x: 478, y: 181, width: 952, height: 755 });
    assert.strictEqual(OneNote.placement, "inside");
    const bounds = placeInside(anchor!, overlay, screen);
    assert.deepStrictEqual(bounds, { x: 1062, y: 189, width: 360, height: 480 });
    assert.isAbove(bounds.x, snapshot.element!.x, "the overlay must not cover the page list");
  });

  it("uses the same corner when the section list is focused instead of the page", () => {
    // A real snapshot right after clicking a section.
    const sectionList = { x: 131, y: 225, width: 215, height: 667 };
    const anchor = OneNote.anchor({ ...snapshot, element: sectionList });
    assert.deepStrictEqual(placeInside(anchor!, overlay, screen), {
      x: 1062,
      y: 189,
      width: 360,
      height: 480,
    });
  });

  it("falls back to the window below the ribbon when no element is focused", () => {
    assert.deepStrictEqual(OneNote.anchor({ ...snapshot, element: null }), {
      x: 84,
      y: 181,
      width: 1346,
      height: 755,
    });
    assert.deepStrictEqual(OneNote.anchor({ ...emptyFocus, element: snapshot.element }), {
      x: 478,
      y: 181,
      width: 952,
      height: 755,
    });
    assert.isNull(OneNote.anchor(emptyFocus));
  });

  it("reports the selected page, not the notebook in the window title", () => {
    assert.deepStrictEqual(OneNote.target(snapshot), {
      app: "Microsoft OneNote",
      document: "Python-kurs",
    });
  });

  it("reports no document when the page list isn't visible", () => {
    const sectionsOnly = { ...snapshot, selection: [snapshot.selection[0]!] };
    assert.isNull(OneNote.target(sectionsOnly).document);
    assert.isNull(OneNote.target({ ...snapshot, selection: [] }).document);
  });
});
