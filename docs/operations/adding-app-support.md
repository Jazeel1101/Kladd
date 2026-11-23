# Adding support for an app

An app adapter tells the logging overlay what to sit next to in one app. Adapters are pure: they pick from a `FocusSnapshot` and never call the OS.

1. Add `packages/adapters/src/<App>.ts`. Copy `OneNote.ts`:
   ```ts
   export const OneNote = AppAdapter.make({
     id: "onenote",
     bundleIds: ["com.microsoft.onenote.mac"],
     anchor: (focus) => focus.caret ?? focus.element ?? focus.window,
   });
   ```
   Find the bundle id with `osascript -e 'id of app "<App name>"'`.
2. Add it to the list in `packages/adapters/src/index.ts`.
3. Test `anchor` with `FocusSnapshot`s shaped like the app's real ones: missing caret, missing element.

If the adapter needs something the snapshot doesn't have (such as a page title), add an optional field to `FocusSnapshot` in domain and fill it in platform-darwin's focus tracker. Don't read it in the adapter.
