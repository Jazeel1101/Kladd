# 0001: Layered monorepo with ports in core

Status: accepted (2026-11-23)

## Context

Kladd is a local-first Electron app that is mostly overlays. macOS comes first, and Windows may follow, so OS-specific code has to be swappable. Coding agents do most of the work, and they copy whatever patterns the repo already has.

## Decision

- **Packages:** domain, contract, core, infra, platform-darwin and rpc-electron, plus two apps, desktop and ui. The graph is in `.dependency-cruiser.cjs`.
- **Ports:** core owns them (`Context.Service` interfaces in `packages/core/src/ports`). infra and `platform-<os>` implement them as Layers.
- **Wiring:** only `apps/desktop/src/main` wires and runs layers.
- **Approved packages:** the list in `.dependency-cruiser.cjs` is an allowlist. Adding a package means writing a new ADR.
- **Enforcement, strongest first:**
  1. pnpm strict installs.
  2. `exports` maps.
  3. A tsconfig `lib`/`types` per package, so domain, core and contract have no DOM and no Node, and ui has no Node.
  4. Effect's `R` type parameter.
  5. dependency-cruiser.
  6. The oxlint rules in `tools/lint/kladd.ts`.

## Consequences

- **New OS:** supporting a new OS means adding one `platform-<os>` package plus a branch in `apps/desktop/src/main/platform.ts`.
- **ui reaching main:** ui can only reach main through contract Rpcs. That costs a little ceremony per feature, and it keeps renderer code free of privileged APIs.
