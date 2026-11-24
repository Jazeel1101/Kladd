# Adding support for an app

An app adapter tells the logging overlay what to sit next to in one app, and what the user is writing in. Adapters are pure: they read a `FocusSnapshot` and never call the OS.

1. Add `packages/adapters/src/apps/<App>.ts`. Copy `OneNote.ts`. Every file there is loaded automatically. The smallest adapter is:
   ```ts
   export const TextEdit = makeAppAdapter({
     id: "textedit",
     bundleIds: ["com.apple.TextEdit"],
     anchor: (focus) => focus.caret ?? focus.element ?? focus.window,
   });
   ```
   Find the bundle id with `osascript -e 'id of app "<App name>"'`. Return `null` to use the no-anchor position. Add `placement: "inside"` when the anchor is a large canvas whose sides hold the app's own lists, as in OneNote.
2. Optionally add `target: (focus) => ({ app, document })`, the `WritingTarget` the overlay shows. Without it the adapter reports the app name and window title (`defaultTarget`). Add it when the title needs cleaning up, or isn't the document: OneNote's title is the notebook, so it reads the page from `focus.selection`, the selected sidebar rows, matched by their `id` (an AXIdentifier, which doesn't change with the UI language).
3. Test it with snapshots shaped like the app's real ones, including missing caret and missing element. Copy `apps/OneNote.test.ts`. To see a real snapshot, build the helper (`vp run @kladd/platform-darwin#build:native`), click into the app, and run `sleep 3; packages/platform-darwin/native/.build/release/kladd-capture focus` from a terminal that has Accessibility permission.

Apps without an adapter use `Generic`: caret, then element, then window, and the default target.

If an adapter needs data the snapshot doesn't have, add a nullable field to `FocusSnapshot` in `packages/domain/src/Focus.ts` and fill it in `Focus.swift`. Don't read it in the adapter.
