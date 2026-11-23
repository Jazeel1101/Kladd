/**
 * Runs sandboxed in every window. Its only job is the RPC MessagePort handshake
 * (see @kladd/rpc-electron/channels). Do not expose APIs with contextBridge: add an Rpc instead.
 */
import { RpcChannel } from "@kladd/rpc-electron/channels";
import { ipcRenderer } from "electron";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data !== RpcChannel.connect) return;
  ipcRenderer.send(RpcChannel.connect);
});

ipcRenderer.on(RpcChannel.port, (event) => {
  window.postMessage(RpcChannel.port, "*", [...event.ports]);
});
