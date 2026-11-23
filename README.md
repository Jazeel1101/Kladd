# Kladd

Local-first desktop app that helps students write their log.

```sh
pnpm install
pnpm dev            # UI dev server + Electron with rebuild on change
vp run check        # the full gate: format, lint, types, graph, tests
pnpm --filter @kladd/desktop package   # build a macOS app into apps/desktop/release
```

Architecture and conventions: [AGENTS.md](AGENTS.md).
