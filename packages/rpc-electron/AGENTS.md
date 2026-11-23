# @kladd/rpc-electron

Transport only: makes a MessagePort look like a WebSocket so Effect RPC socket protocols run over Electron IPC. How it works: `docs/internals/rpc-over-messageports.md`.
Entry points: `/client` (ui), `/server` (desktop main), `/channels` (preload).
Imports: `effect` only. `server.ts` uses structural types instead of importing electron.
App features never land here; they go in contract + core.
