# 0003: Toolchain choices that look like mistakes

Status: accepted (2026-11-23)

- **`typescript@7.1.0-beta`, pinned exactly.**
  - dependency-cruiser 18.9 rejects TypeScript 7.0.x but accepts 7.1, and `@effect/tsgo` 0.67.1 supports 7.1.0-beta.
  - Move to 7.1.0 once it is stable.
- **Typecheck runs `effect-tsgo tsc` per package, not `vp check`'s type check.**
  - It adds Effect's diagnostics.
  - It enforces each package's own `lib`/`types`.
  - Each package's `typecheck` script lists its tsconfigs. The `vite.config.ts` files get a separate Node-typed tsconfig so app code stays free of Node types.
- **The lint plugin imports `vite-plus/lint/plugins`, not `@oxlint/plugins`.**
  - vite-plus bundles oxlint and re-exports the matching plugin API.
  - vite-plus's own lint rule (`prefer-vite-plus-imports`) forbids the direct import.
- **apps/desktop bundles everything with `vp pack`.**
  - Workspace packages and effect are devDependencies, so electron-builder ships only real runtime dependencies (`electron-updater`).
  - The sandboxed preload must be CommonJS.
- **The UI router uses hash history.** Production loads `index.html` from `file://`, where path-based URLs do not resolve. Each window opens its route through the hash.
