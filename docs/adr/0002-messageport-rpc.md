# 0002: Effect RPC over Electron MessagePorts

Status: accepted (2026-11-23)

## Context

The UI runs in sandboxed renderers and needs typed calls into the main process. Effect RPC already ships socket protocols for this. The alternative was a localhost WebSocket server using the built-in protocols plus a token. We rejected it: it opens a port that every local process can reach, and it adds token handling.

## Decision

`packages/rpc-electron` wraps a MessagePort as `Socket.WebSocketLike`, so `RpcClient.layerProtocolSocket` and `RpcServer.layerProtocolSocketServer` run unchanged over Electron IPC. Serialization is `RpcSerialization.layerJson`.

Handshake (names in `packages/rpc-electron/src/channels.ts`):

1. The renderer posts `kladd:rpc-connect` to its own window.
2. The preload forwards it to main with `ipcRenderer.send`.
3. Main rejects senders whose URL is not the app (`isAppUrl`), creates a `MessageChannelMain`, keeps `port1`, and sends `port2` back.
4. The preload transfers the port to the renderer with `window.postMessage`.

The renderer starts the handshake, so it reconnects on its own after a reload.

## Consequences

- **No network:** no port is opened, and nothing is exposed through `contextBridge`.
- **Upgrades:** `server.ts` uses structural types and so does not depend on Electron. When effect is upgraded, check the `Socket.fromWebSocket` behaviour the adapter relies on (`readyState`, plus `message` and `close` events).
