# Summary agent

When a session's folder is finished (`finishSession`), `SummaryAgentClaude` (`packages/infra/src/summary`) runs the student's own Claude Code through `@anthropic-ai/claude-agent-sdk` in that folder, and it writes `summary.md`. Without `claude` or a login it fails with `SummaryFailed`, which is logged, and the student logs without a summary.

- **The student's `claude`.** `pathToClaudeCodeExecutable` points at their install (`~/.local/bin`, `~/.claude/local`, Homebrew), so it runs on their login and plan. The SDK's bundled binaries are left out by `ignoredOptionalDependencies` in `pnpm-workspace.yaml`.
- **None of their setup.** `settingSources: []`, no skills, MCP servers or claude.ai connectors, no saved transcript or memory, and an `env` that replaces Kladd's: `HOME`, `USER` (Claude Code finds the keychain login with them), a system `PATH`, and telemetry, error reporting, auto-update and other non-essential traffic off. A login that only works through `ANTHROPIC_*` in `~/.claude/settings.json` does not reach the agent.
- **Reads Kladd's data folder only, writes `summary.md` only.** Three layers, each enough on its own for its tools:
  - a `PreToolUse` hook, `deniedToolUse`, that checks every Read, Glob, Grep, Write and Edit path and denies any other tool but Bash and `frame_at`;
  - permission rules in the same shape, with `permissionMode: "dontAsk"` and `permissionPrompts: "none"`, so anything not allowed is denied, never asked;
  - the sandbox for Bash (`failIfUnavailable`, no unsandboxed commands): `/Users` and `/Volumes` closed to reads but for the data folder, the data folder closed to writes, and no network domain allowed (`strictAllowlist`).
- **`frame_at(clip, t)`** is an in-process MCP tool: `VideoFrames` (`kladd-capture frame`) saves `clips/<clip>/frames/<t>.jpg`, and the agent opens it with Read.
- **Claude Code's own files.** It leaves `.claude/` in its working folder; the adapter removes it afterwards.

Checked on 2026-11-27 with Claude Code 2.1.325 on a synthetic session: the agent wrote a Norwegian `summary.md` from the screenshot, transcript and four frames, and an agent told to escape could not read a file in `~`, list `/Users`, write outside `summary.md`, change `overview.md`, or reach `example.com` or `1.1.1.1`; Claude Code connected only to its API and the sandbox's local proxy.
