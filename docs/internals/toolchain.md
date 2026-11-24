# Toolchain quirks

Things that look like mistakes but aren't.

- **`typescript@7.1.0-beta`, pinned exactly.** dependency-cruiser rejects TS 7.0.x and accepts 7.1. `@effect/tsgo` supports 7.1.0-beta. Move to 7.1.0 when it's stable.
- **Typecheck is `effect-tsgo tsc` per package**, not `vp check`. That adds Effect's diagnostics and enforces each package's own `lib`/`types` (no DOM or Node in domain/core/contract, no Node in ui). `vite.config.ts` files get a separate Node-typed tsconfig so app code stays Node-free.
- **The lint plugin imports `vite-plus/lint/plugins`**, not `@oxlint/plugins`. vite-plus bundles oxlint, and its own `prefer-vite-plus-imports` rule forbids the direct import.
- **apps/desktop bundles everything with `vp pack`.** Workspace packages and effect are devDependencies, so electron-builder ships only real runtime deps (`electron-updater`). The sandboxed preload must be CommonJS.
- **`electron-updater` has a plain version range, not `catalog:`**, because electron-builder can't read catalog specifiers.
- **A window is picked by the URL hash.** Every window loads the same `index.html` with its `WindowKind` as the hash (`#pill`), and `apps/ui/src/main.tsx` renders that window. A hash, not a path, because production loads from `file://`.
- **`import.meta.glob` negation must be relative** (`"!./apps/*.test.ts"`). Rolldown (`vp pack`) ignores `"!**/..."` and would bundle test files and vitest into the app; vitest accepts both. Used in `packages/adapters/src/index.ts`.
- **PermissionFlow is left out of the Swift helper without Xcode.** In the macOS 27 SDK SwiftUI's `@State` is a macro, and its plugin ships only with Xcode, not Command Line Tools. `packages/platform-darwin/native/build.sh` detects this; `docs/internals/screen-capture.md` has the details.
