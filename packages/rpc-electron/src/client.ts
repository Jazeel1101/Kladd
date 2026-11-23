/**
 * Renderer side. Import from "@kladd/rpc-electron/client" (apps/ui only).
 * Gives an RpcClient.Protocol that talks to the main process over a MessagePort.
 */
import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { RpcChannel } from "./channels";

const requestPort = Effect.callback<MessagePort>((resume) => {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data !== RpcChannel.port) return;
    const port = event.ports[0];
    if (port === undefined) return;
    window.removeEventListener("message", onMessage);
    resume(Effect.succeed(port));
  };
  window.addEventListener("message", onMessage);
  // Same-window message to our preload; "*" is required because file:// has an opaque origin.
  window.postMessage(RpcChannel.connect, "*");
  return Effect.sync(() => window.removeEventListener("message", onMessage));
});

type Listener = (event: Socket.WebSocketEvent) => void;

/** Makes a DOM MessagePort look like the WebSocket subset Effect's Socket needs. */
const portAsWebSocket = (port: MessagePort): Socket.WebSocketLike => {
  const wrapped = new Map<Listener, (event: MessageEvent) => void>();
  port.start();
  return {
    readyState: 1, // OPEN: a transferred port is usable immediately
    addEventListener(type, listener) {
      // DOM MessagePorts only emit "message"; there is no open/close/error to forward.
      if (type !== "message") return;
      const onMessage = (event: MessageEvent) => listener({ type: "message", data: event.data });
      wrapped.set(listener, onMessage);
      port.addEventListener("message", onMessage);
    },
    removeEventListener(type, listener) {
      const onMessage = wrapped.get(listener);
      if (type !== "message" || onMessage === undefined) return;
      wrapped.delete(listener);
      port.removeEventListener("message", onMessage);
    },
    close: () => port.close(),
    send: (data) => port.postMessage(data),
  };
};

const layerSocket = Layer.effect(
  Socket.Socket,
  Socket.fromWebSocket(
    Effect.acquireRelease(Effect.map(requestPort, portAsWebSocket), (ws) =>
      Effect.sync(() => ws.close()),
    ),
  ),
);

export const layerProtocol: Layer.Layer<RpcClient.Protocol> = RpcClient.layerProtocolSocket({
  retryTransientErrors: true,
}).pipe(Layer.provide([layerSocket, RpcSerialization.layerJson]));
