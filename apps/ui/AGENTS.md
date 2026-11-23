# @kladd/ui

React renderer. One app, one route per window (`src/routes/`, TanStack file routes, hash history).
Talk to main only through `KladdClient` atoms (`src/rpc.ts`); copy `src/recording/` (atoms + component).
Imports: `@kladd/contract`, `@kladd/domain`, `@kladd/rpc-electron/client`, browser npm packages. Runs sandboxed: no electron, no Node.
Components: `@ui-sdk/react/*` behaviours styled with Tailwind, classes merged with `cn` (`src/lib/cn.ts`). ui-sdk docs: `node_modules/@ui-sdk/react/docs/llms.txt`.
