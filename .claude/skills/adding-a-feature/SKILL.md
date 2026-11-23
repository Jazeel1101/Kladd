---
name: adding-a-feature
description: Use when adding a feature that crosses packages, such as a new use case, Rpc, port, OS capability or window.
---

# Adding a feature

Build the feature as a vertical slice through the layers, copying the "start recording" slice at each step. Do the steps in order. Skip a step only when the feature doesn't touch that layer.

1. **Name it.** Look the concept up in `GLOSSARY.md`, and add a row if it's new. Done when every new type and function uses a glossary name.
2. **Domain** (`packages/domain`). Add the schemas, branded IDs and `Schema.TaggedError` errors, plus pure functions with tests. Copy `src/RecordingSession.ts`. Done when it is exported from `src/index.ts`.
3. **Contract** (`packages/contract/src/KladdRpcs.ts`). Add an `Rpc.make(...)` whose payload, success and error all come from domain. Done when every error the UI must handle appears in `error`.
4. **Core ports** (`packages/core/src/ports`). Add one `Context.Service` for each outside capability the use case needs. Add a test layer for each in `src/testing/index.ts`. Copy `ScreenCapture.ts`. Done when every port has a test layer.
5. **Core use case** (`packages/core/src/<feature>/`). Write a service with a static `layer` that depends only on ports, plus tests built on the test layers. Copy `recording/Recordings.ts` and `Recordings.test.ts`. Done when every success and error path has a test.
6. **Implementations.** OS-specific work goes in `packages/platform-darwin` (copy `ScreenCaptureDarwin.ts`). Work that runs on any OS goes in `packages/infra` (copy `recording/RecordingStoreFile.ts` and its test). Done when every new port has a live layer.
7. **Wire** (`apps/desktop/src/main`). Provide the new layers in `MainLive.ts` (OS layers in `platform.ts`), and add a one-line handler per Rpc in `rpc/handlers.ts`. Done when `vp run @kladd/desktop#typecheck` passes. A missing layer shows up there as a missing-service error.
8. **UI** (`apps/ui/src/<feature>/`). Add atoms from `KladdClient.query` / `KladdClient.mutation` with shared `reactivityKeys`, a component that renders every error tag, and a route in `src/routes/` if it's a new window. Copy `src/recording/`. Done when each error tag has a message.
9. **Gate.** Run `vp run check` and fix what it reports. Each message says how. Done when it exits 0.

If a step seems to require breaking a rule, such as importing core from ui, adding a package, or throwing, the feature belongs in a different layer. Re-read the package's `AGENTS.md`, or ask the user before writing an ADR.
