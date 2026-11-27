# Kladd

Kladd is a local-first desktop overlay, macOS first, that records what a student does on screen and helps them write their log about it. Product terms, Norwegian to code: [GLOSSARY.md](GLOSSARY.md).

## What makes Kladd special

We can't compromise on these.

- **Overlays only:** Kladd is a pill and overlays. Nothing else, and it never takes focus from the app the student writes in, unless the student clicks into an overlay's composer.
- **Nothing leaves the Mac:** except to the student's own LLM key or subscription. No Kladd server, account or telemetry, not even opt-in.
- **Light:** simple, fast and small. No bundled models, no downloads the student waits for, and every new interaction stays one simple step.
- **Recording never breaks:** permissions are set up before the first recording; after that, Kladd falls back instead of failing.

## General principles

- Channel your inner DRY, YAGNI, KISS and SOLID.
- Build on the shared layer each area already has. If it can't do what you need, extend it there.
- Write real fixes, not bypasses.
- Keep code in one function unless a part is reused or composable. Extract a helper only when it names a real concept.
- Validate unknown values once, at the boundary that owns them, and pass typed values inward.
- Before adding complexity for a speculative or vanishingly unlikely race or edge case, explain the concrete failure mode, likelihood and complexity cost to the user and get their buy-in.
- If a short request has two possible meanings, ask one question before you start.
- Call a bug fixed only when a test, log or recording shows it.
- Turn a mistake the next agent could repeat into a type error or a lint rule with a fix-it message (`tools/lint/kladd.ts`), not a doc line.

## How it works

The Electron main process is the backend; every window is a thin view over it, picked by URL hash (`#pill`) from one window table in `apps/desktop/src/main/windows.ts`:

| Window             | Where                                                               | Shows                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecordingPill`    | Left screen edge, ~4/5 down; dragged to any edge, or floating       | Always. Settings chevron, then per session state: start; screenshot, end. Logging mode: log settings, overlay, done. Menu: the session's actions, clip, mode, Settings, Quit |
| `LoggingOverlay`   | Grown out of the pill (`docs/internals/overlay-placement.md`)       | When a session ends, and from the pill's star                                                                                                                                |
| `ExpandedView`     | Overlay                                                             | Opened from the pill: past sessions                                                                                                                                          |
| `ScreenshotFlight` | Over the whole main display (`docs/internals/screenshot-flight.md`) | While a ⌃⇧C screenshot flies into the pill                                                                                                                                   |
| Settings           | The only normal window                                              | Opened from the pill menu                                                                                                                                                    |

The UI reaches main only through `KladdRpcs` over MessagePorts (`docs/internals/rpc-over-messageports.md`); the pill menu is the other entry point. OS work runs in the Swift helper `kladd-capture`, one process per call, so macOS attributes its permissions to Kladd. Dependencies point inward, `apps → infra/platform → core → domain`, and each package's `AGENTS.md` says what belongs there and which file to copy:

| Package                    | Holds                                                           |
| -------------------------- | --------------------------------------------------------------- |
| `packages/domain`          | Schemas, branded IDs, tagged errors, pure functions             |
| `packages/contract`        | `KladdRpcs`: every call ui can make to main                     |
| `packages/core`            | Use cases, and the ports (interfaces) they need                 |
| `packages/infra`           | Port implementations that work on any OS (files, IDs, LLM)      |
| `packages/platform-darwin` | Port implementations for macOS, via the Swift helper            |
| `packages/adapters`        | One pure adapter per supported app (what the student writes in) |
| `packages/rpc-electron`    | MessagePort transport for Effect RPC                            |
| `apps/desktop`             | Electron main + preload; the only place layers are wired        |
| `apps/ui`                  | React renderer, one route per window                            |

A feature that crosses packages copies the "session" slice: `packages/domain/src/Session.ts` → `packages/core/src/session/Sessions.ts` → `packages/platform-darwin/src/SessionCaptureDarwin.ts` + `packages/infra/src/session/SessionStoreFile.ts` → `apps/desktop/src/main/MainLive.ts`, watched through `WatchSession` → `apps/ui/src/session/atoms.ts` → `apps/ui/src/pill/`. A new app is one adapter file: `docs/operations/adding-app-support.md`.

Effect is v4 (`effect@4.1.5`), whose APIs differ from v3: read `node_modules/effect/ai-docs/` rather than recalling v3. Write functions with `Effect.fn("Name.method")`, services with `class X extends Context.Service<X, {...}>()("kladd/<package>/X")`, errors with `Schema.TaggedError` in domain. Toolchain choices that look like mistakes are explained in `docs/internals/toolchain.md`.

## Hazards

1. **Killing Electron by name.** The user runs other Electron apps, including the one hosting you. Stop Kladd by the pid you started, or by quitting from the pill menu; never `pkill`/`killall Electron`.
2. **Recording the user's screen.** Screenshots and videos show whatever is on the user's real display. Look at one before you attach it to a PR or send it anywhere, and crop or leave it out if it shows anything beyond Kladd and the app under test.
3. **Resetting macOS permissions.** `tccutil reset ScreenCapture` or `Accessibility` without a bundle id revokes the grant for every app on the Mac. Reset only Kladd's bundle id, and only when the user asks.
4. **The live data folder.** `~/Library/Application Support/Kladd` holds the user's real recordings, shared by `pnpm dev` and the installed app. Point tests and experiments at a temp `StorageConfig.dataDir`; never delete or rewrite files there.
5. **The signing certificate.** "Kladd Self-Signed" in the login keychain ties every user's screen recording grant to it. Never delete it or run `signing:setup` on a Mac that already has it; `docs/operations/signing.md` has the safe path.

## Docs

- Agents read the code, so most changes need no doc.
- `docs/` has two folders and nothing else: `docs/operations/` for how to do a non-trivial operation, `docs/internals/` for details that are hard to see from the code. Keep each doc short.
- Record a decision only when it is hard to reverse, surprising without context and the result of a real trade-off. If any of the three is missing, skip it.
- A decision record is one concise paragraph: the context, the decision and why.
- State each fact once, in the doc that owns it. Delete what a change makes stale in the same change.
- Add a `GLOSSARY.md` row before naming a new concept.

## Checks

- `vp run check` is the definition of done. The pre-commit hook and the Claude Code Stop hook run it too; each error says how to fix it.
- Test the real implementation instead of copying its logic into the test or mocking it.
- The check can't click the pill's native menu or see where an overlay lands. For those, run the app (`pnpm dev`) and show a screenshot; to see a real `FocusSnapshot`, follow step 3 of `docs/operations/adding-app-support.md`.
- `pnpm dev` and `package` build the Swift helper, which needs Xcode and macOS 15.

## Branches and pull requests

- Use a short branch name of at most three hyphenated words, such as `session-recovery` or `fix-scroll-state`.
- Use conventional commit titles: `type(scope): summary`.
- Make a PR only when asked.

## Code and residue

- Add comments only where the code can't speak for itself.
- Keep plans, research notes and scratch files outside the worktree.
