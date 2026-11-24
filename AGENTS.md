# Kladd

Local-first macOS overlay (Electron) that records what a student does and helps write their log. Product terms: [GLOSSARY.md](GLOSSARY.md).

## Product shape

Kladd is overlays only. Never add a main window or a Dock or menu bar icon. The Electron main process is the backend, and every window is a thin view over it, with one UI route each:

| Window             | Where                                                                 | Shows                                                                      |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `RecordingPill`    | Left screen edge, ~4/5 down; dragged to any edge, or floating         | Always. Chevron: expanded view. Menu: start/stop recording, Settings, Quit |
| `LoggingOverlay`   | Next to where the user writes (`docs/internals/overlay-placement.md`) | When a recording stops                                                     |
| `ExpandedView`     | Overlay                                                               | Opened from the pill: summary and images                                   |
| `ScreenshotFlight` | Over the whole main display (`docs/internals/screenshot-flight.md`)   | While a ⌃⇧C screenshot flies into the pill                                 |
| Settings           | The only normal window                                                | Opened from the pill menu                                                  |

Supporting a new app is an adapter in `packages/adapters`: see `docs/operations/adding-app-support.md`.

## Gate

`vp run check` is the definition of done: format, lint, typecheck, dependency graph, knip, sherif, tests. Run it before you finish; the pre-commit hook and the Claude Code Stop hook run it too. Each error message says how to fix it. Follow the message.

## Docs

`docs/` has two folders and nothing else: `docs/operations/` for how to do a non-trivial operation in the codebase, and `docs/internals/` for implementation details that are hard to see from the code. Keep each doc short. Don't write design rationale, plans or anything the code or config already shows; it goes stale.

## Map

Dependencies point inward: `apps → infra/platform → core → domain`.

| Package                    | Holds                                                      |
| -------------------------- | ---------------------------------------------------------- |
| `packages/domain`          | Schemas, branded IDs, tagged errors, pure functions        |
| `packages/contract`        | `KladdRpcs`: every call ui can make to main                |
| `packages/core`            | Use cases, and the ports (interfaces) they need            |
| `packages/infra`           | Port implementations that work on any OS (files, IDs, LLM) |
| `packages/platform-darwin` | Port implementations for macOS (screen capture, focus)     |
| `packages/adapters`        | One pure adapter per supported app (overlay anchoring)     |
| `packages/rpc-electron`    | MessagePort transport for Effect RPC                       |
| `apps/desktop`             | Electron main + preload; the only place layers are wired   |
| `apps/ui`                  | React renderer, one route per window                       |

Each package has an `AGENTS.md` with what belongs there and the file to copy.

## Adding a feature

Use the `adding-a-feature` skill. The example slice it follows is "recording": `packages/domain/src/RecordingSession.ts` → `packages/core/src/recording/Recordings.ts` → `packages/platform-darwin/src/ScreenCaptureDarwin.ts` + `packages/infra/src/recording/RecordingStoreFile.ts` → `apps/desktop/src/main/MainLive.ts`. The user starts and stops it from the pill menu (`apps/desktop/src/main/pillMenu.ts`); the UI watches it through the `WatchRecording` Rpc (`packages/contract/src/KladdRpcs.ts` → `apps/ui/src/recording/atoms.ts` → `apps/ui/src/pill/`). Stopping a recording opens the logging overlay: `packages/core/src/logging/LoggingOverlay.ts`.

## Effect style

Effect v4 (`effect@4.1.5`). Its APIs differ from v3; read `node_modules/effect/ai-docs/` rather than recalling v3. Write functions with `Effect.fn("Name.method")`, services with `class X extends Context.Service<X, {...}>()("kladd/<package>/X")`, errors with `Schema.TaggedError` in domain.
