# Toolchain quirks

Things that look like mistakes but aren't.

- **`typescript@7.1.0-beta`, pinned exactly.** dependency-cruiser rejects TS 7.0.x and accepts 7.1. `@effect/tsgo` supports 7.1.0-beta. Move to 7.1.0 when it's stable.
- **Typecheck is `effect-tsgo tsc` per package**, not `vp check`. That adds Effect's diagnostics and enforces each package's own `lib`/`types` (no DOM or Node in domain/core/contract, no Node in ui). `vite.config.ts` files get a separate Node-typed tsconfig so app code stays Node-free.
- **The lint plugin imports `vite-plus/lint/plugins`**, not `@oxlint/plugins`. vite-plus bundles oxlint, and its own `prefer-vite-plus-imports` rule forbids the direct import.
- **apps/desktop bundles everything with `vp pack`.** Workspace packages and effect are devDependencies, so electron-builder ships only real runtime deps (`electron-updater`). The sandboxed preload must be CommonJS.
- **`electron-updater` has a plain version range, not `catalog:`**, because electron-builder can't read catalog specifiers.
- **The UI router uses hash history.** Production loads `index.html` from `file://`, where path URLs don't resolve. Each window opens its route via the hash.
