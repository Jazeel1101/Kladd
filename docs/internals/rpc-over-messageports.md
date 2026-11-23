# RPC over MessagePorts

Renderers reach main through Effect RPC, with no network port and nothing exposed on `contextBridge`.

`packages/rpc-electron` wraps a MessagePort as `Socket.WebSocketLike`, so Effect's stock `RpcClient.layerProtocolSocket` and `RpcServer.layerProtocolSocketServer` run unchanged (JSON serialization).

Handshake (message names in `packages/rpc-electron/src/channels.ts`):

1. The renderer posts `kladd:rpc-connect` to its own window.
2. The preload forwards it to main with `ipcRenderer.send`.
3. Main drops senders whose URL isn't the app (`isAppUrl`), creates a `MessageChannelMain`, keeps `port1` and sends `port2` back.
4. The preload transfers the port to the renderer with `window.postMessage`.

The renderer starts the handshake, so a reloaded window reconnects on its own.

When upgrading effect: the adapter depends on how `Socket.fromWebSocket` uses `readyState` and the `message`/`close` events. `server.ts` uses structural types, so it never imports Electron.
