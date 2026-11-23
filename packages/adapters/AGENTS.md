# @kladd/adapters

One file per supported app: where the logging overlay sits in that app. Recipe: `docs/operations/adding-app-support.md`.
Imports: `@kladd/domain` only. Adapters are pure functions over a `FocusSnapshot`; they never call the OS.
Copy: `src/OneNote.ts` and its test. Register the adapter in `src/index.ts`.
