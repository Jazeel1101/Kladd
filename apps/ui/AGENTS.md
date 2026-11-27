# @kladd/ui

React renderer. One app; `src/main.tsx` maps each `WindowKind` to the component that window shows.
Talk to main only through `KladdClient` atoms (`src/rpc.ts`); copy `src/session/atoms.ts` (live state) and `src/pill/` (component).
Imports: `@kladd/contract`, `@kladd/domain`, `@kladd/rpc-electron/client`, browser npm packages. Runs sandboxed: no electron, no Node.
Components: `@ui-sdk/react/*` behaviours styled with Tailwind, classes merged with `cn` (`src/lib/cn.ts`). ui-sdk docs: `node_modules/@ui-sdk/react/docs/llms.txt`.
