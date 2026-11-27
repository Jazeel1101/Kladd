# @kladd/desktop

Electron main + preload. The composition root: `src/main/MainLive.ts` is the only place layers are wired and run.
`src/main/rpc/handlers.ts` maps each contract Rpc to a core use case, one line each. The pill's actions (`src/main/pillActions.ts`) call core use cases and turn errors into dialogs, nothing more; the pill's buttons reach them through handlers, and its native menu (`src/main/pillMenu.ts`) directly.
Windows load UI routes (`src/main/windows.ts`) with contextIsolation + sandbox on; preload only does the port handshake.
Everything is bundled by `vp pack`; only packages that cannot be bundled go in `dependencies` (shipped by electron-builder).
