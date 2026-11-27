import { assert, describe, it } from "@effect/vitest";
import type { FocusSnapshot } from "@kladd/domain";
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

describe("OneNote", () => {
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
