# @kladd/adapters

One file per supported app: where the logging overlay sits in that app. Recipe: `docs/operations/adding-app-support.md`.
Imports: `@kladd/domain` only. Adapters are pure functions over a `FocusSnapshot`; they never call the OS.
Copy: `src/apps/OneNote.ts` and its test. Every file in `src/apps/` is loaded as an adapter (`src/index.ts`).
