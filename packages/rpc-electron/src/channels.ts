/**
 * Message names for the MessagePort handshake (see docs/internals/rpc-over-messageports.md):
 *   1. renderer  --window.postMessage(connect)-->  preload  --ipcRenderer.send(connect)-->  main
 *   2. main creates a MessageChannelMain, keeps port1, sends port2 back on `port`
 *   3. preload forwards port2 to the renderer with window.postMessage(port, "*", [port2])
 */
export const RpcChannel = {
  connect: "kladd:rpc-connect",
  port: "kladd:rpc-port",
} as const;
