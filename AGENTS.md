# Kladd

Local-first macOS desktop app (Electron) that records what a student does and helps write their log. Product terms: [GLOSSARY.md](GLOSSARY.md). Why things are the way they are: [docs/adr/](docs/adr/). Read the relevant ADR before changing a decision it records.

## Gate

`vp run check` is the definition of done: format, lint, typecheck, dependency graph, knip, sherif, tests. Run it before you finish; the pre-commit hook and the Claude Code Stop hook run it too. Each error message says how to fix it. Follow the message.

## Map

Dependencies point inward: `apps → infra/platform → core → domain`.

| Package                    | Holds                                                      |
| -------------------------- | ---------------------------------------------------------- |
| `packages/domain`          | Schemas, branded IDs, tagged errors, pure functions        |
| `packages/contract`        | `KladdRpcs`: every call ui can make to main                |
| `packages/core`            | Use cases, and the ports (interfaces) they need            |
| `packages/infra`           | Port implementations that work on any OS (files, IDs, LLM) |
| `packages/platform-darwin` | Port implementations for macOS (screen capture, overlays)  |
| `packages/rpc-electron`    | MessagePort transport for Effect RPC                       |
| `apps/desktop`             | Electron main + preload; the only place layers are wired   |
| `apps/ui`                  | React renderer, one route per window                       |

Each package has an `AGENTS.md` with what belongs there and the file to copy.

## Adding a feature

Use the `adding-a-feature` skill. The example slice it follows is "start recording": `packages/domain/src/RecordingSession.ts` → `packages/contract/src/KladdRpcs.ts` → `packages/core/src/recording/Recordings.ts` → `packages/platform-darwin/src/ScreenCaptureDarwin.ts` + `packages/infra/src/recording/RecordingStoreFile.ts` → `apps/desktop/src/main/MainLive.ts` → `apps/ui/src/recording/`.

## Effect style

Effect v4 (`effect@4.1.5`). Its APIs differ from v3; read `node_modules/effect/ai-docs/` rather than recalling v3. Write functions with `Effect.fn("Name.method")`, services with `class X extends Context.Service<X, {...}>()("kladd/<package>/X")`, errors with `Schema.TaggedError` in domain.
