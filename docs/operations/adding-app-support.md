# Adding support for an app

An app adapter tells the logging overlay what the student is writing in, in one app: the `WritingTarget` its header shows. The overlay itself always grows out of the pill. Adapters are pure: they read a `FocusSnapshot` and never call the OS.

1. Add `packages/adapters/src/apps/<App>.ts`. Copy `OneNote.ts`. Every file there is loaded automatically. An adapter is its bundle ids and a `target`:
   ```ts
   export const TextEdit = makeAppAdapter({
     id: "textedit",
     bundleIds: ["com.apple.TextEdit"],
     target: (focus) => ({ app: "TextEdit", document: focus.title?.replace(/\.rtf$/, "") ?? null }),
   });
   ```
   Find the bundle id with `osascript -e 'id of app "<App name>"'`. Without `target` the adapter reports the app name and window title (`defaultTarget`), which `Generic` already does for every app, so add an adapter only when the title needs cleaning up or isn't the document.
2. When the title isn't the document, read it from the snapshot: OneNote's title is the notebook, so it reads the page from `focus.selection`, the selected sidebar rows, matched by their `id` (an AXIdentifier, which doesn't change with the UI language).
3. Test it with snapshots shaped like the app's real ones, including a missing title and selection. Copy `apps/OneNote.test.ts`. To see a real snapshot, build the helper (`vp run @kladd/platform-darwin#build:native`), click into the app, and run `sleep 3; packages/platform-darwin/native/.build/release/kladd-capture focus` from a terminal that has Accessibility permission.

Apps without an adapter use `Generic`: the default target.

If an adapter needs data the snapshot doesn't have, add a nullable field to `FocusSnapshot` in `packages/domain/src/Focus.ts` and fill it in `Focus.swift`. Don't read it in the adapter.
