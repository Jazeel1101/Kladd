<p align="center">
  <img src="logo/variants/kladd-symbol-app-icon.svg" width="96" alt="Kladd app icon">
</p>

<h1 align="center">Kladd</h1>

<p align="center">Records what you do on screen and helps you write your log about it. Everything stays on your Mac.</p>

<p align="center">
  <img src=".github/readme/summary-overlay.png" width="760" alt="Kladd's pill on the left screen edge, with the summary of a work session open beside a log being written in TextEdit">
</p>

## How to use Kladd

Kladd is a small pill on the edge of your screen. Drag it to any edge you like.

<p align="center">
  <img src=".github/readme/pill-states.png" width="760" alt="The pill in its three states: ready to start, recording, and logging">
</p>

1. **Start a session** with the ring on the pill.
2. **Work as usual.** Press `⌃⇧C` for a screenshot, or `⌥⇧C` to record a clip and talk about what you are doing.
3. **End the session** with the red dot. Kladd writes a summary of what you did, using your own LLM key or subscription, and shows it beside the pill. Write your log from it, then press the checkmark.

## Development

```sh
pnpm install
pnpm dev            # UI dev server + Electron with rebuild on change
vp run check        # the full gate: format, lint, types, graph, tests
pnpm --filter @kladd/desktop package   # build a macOS app into apps/desktop/release
```

Architecture and conventions: [AGENTS.md](AGENTS.md).
