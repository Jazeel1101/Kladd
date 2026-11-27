# Summary agent

When a session's folder is finished (`finishSession`), `SummaryAgentClaude` (`packages/infra/src/summary`) runs the student's own Claude Code through `@anthropic-ai/claude-agent-sdk` in that folder, and it writes `summary.md`. Without `claude` or a login it fails with `SummaryFailed`, which is logged, and the student logs without a summary.

- **The student's `claude`.** `pathToClaudeCodeExecutable` points at their install (`~/.local/bin`, `~/.claude/local`, Homebrew), so it runs on their login and plan. The SDK's bundled binaries are left out by `ignoredOptionalDependencies` in `pnpm-workspace.yaml`.
- **None of their setup.** `settingSources: []`, no skills, MCP servers or claude.ai connectors, no saved transcript or memory, and an `env` that replaces Kladd's: `HOME`, `USER` (Claude Code finds the keychain login with them), a system `PATH`, and telemetry, error reporting, auto-update and other non-essential traffic off. A login that only works through `ANTHROPIC_*` in `~/.claude/settings.json` does not reach the agent.
- **Reads Kladd's data folder only, writes `summary.md` only.** It gets Read, Glob, Grep, Write, Edit and `frame_at`, and no Bash: a shell, even sandboxed, can read system files and write to temp folders. Then:
  - a `PreToolUse` hook, `deniedToolUse`, checks every path and denies any other tool;
  - permission rules in the same shape, with `permissionMode: "dontAsk"` and `permissionPrompts: "none"`, deny anything not allowed instead of asking;
  - the sandbox (`failIfUnavailable`, no unsandboxed commands, `/Users` and `/Volumes` closed but for the data folder, no network) covers any command that runs after all.
- **Network.** Only Claude Code itself goes online, unsandboxed: to the API, and to refresh the login. Both are Anthropic's.
- **Retried until logged.** A folder without `summary.md` counts as unfinished until the session is logged, so a quit during the summary runs it again at the next launch; a logged session is never summarized.
- **`frame_at(clip, t)`** is an in-process MCP tool: `VideoFrames` (`kladd-capture frame`) saves `clips/<clip>/frames/<t>.jpg`, and the agent opens it with Read.
- **Claude Code's own files.** It leaves `.claude/` in its working folder; the adapter removes it afterwards.

Checked on 2026-11-27 with Claude Code 2.1.325 on a synthetic session: the agent wrote a Norwegian `summary.md` from the screenshot, transcript and four frames, and an agent told to escape could not read a file in `~`, write outside `summary.md`, or reach the network (then still with sandboxed Bash, which could not read `~`, list `/Users`, change `overview.md`, or reach `example.com` or `1.1.1.1`); Claude Code connected only to its API and the sandbox's local proxy.
