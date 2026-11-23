# Adding support for an app

An app adapter tells the logging overlay what to sit next to in one app. Adapters are pure: they pick a rect from a `FocusSnapshot` and never call the OS.

1. Add `packages/adapters/src/apps/<App>.ts`. Copy `OneNote.ts`. Every file there is loaded automatically:
   ```ts
   export const OneNote = makeAppAdapter({
     id: "onenote",
     bundleIds: ["com.microsoft.onenote.mac"],
     anchor: (focus) => focus.element ?? focus.window,
   });
   ```
   Find the bundle id with `osascript -e 'id of app "<App name>"'`. Return `null` to use the no-anchor position.
2. Test `anchor` with snapshots shaped like the app's real ones, including missing caret and missing element. Copy `apps/OneNote.test.ts`.

Apps without an adapter use `Generic` (caret, then element, then window).

If an adapter needs data the snapshot doesn't have (such as a page title), add an optional field to `FocusSnapshot` in `packages/domain/src/Focus.ts` and fill it in platform-darwin's focus tracker. Don't read it in the adapter.
