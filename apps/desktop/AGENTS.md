# @kladd/desktop

Electron main + preload. The composition root: `src/main/MainLive.ts` is the only place layers are wired and run.
`src/main/rpc/handlers.ts` maps each contract Rpc to a core use case, one line each.
Windows load UI routes (`src/main/windows.ts`) with contextIsolation + sandbox on; preload only does the port handshake.
Everything is bundled by `vp pack`; only packages that cannot be bundled go in `dependencies` (shipped by electron-builder).
