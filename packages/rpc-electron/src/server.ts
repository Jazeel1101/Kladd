/**
 * Main-process side. Import from "@kladd/rpc-electron/server" (apps/desktop only).
 * Structural types only: this file must not import electron or node:*.
 */
import { Context, Effect, Layer, Queue } from "effect";
import { NetAddress } from "effect/net";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";

/** The parts of Electron's MessagePortMain this package uses. */
export interface MainPortLike {
  addListener(event: "message", listener: (event: { readonly data: unknown }) => void): unknown;
  addListener(event: "close", listener: () => void): unknown;
  removeListener(event: "message", listener: (event: { readonly data: unknown }) => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

/** Hand every new renderer port to `accept`; the RPC server serves it until the port closes. */
export class RpcPorts extends Context.Service<
  RpcPorts,
  {
    readonly accept: (port: MainPortLike) => Effect.Effect<void>;
    readonly next: Effect.Effect<MainPortLike>;
  }
>()("kladd/rpc-electron/RpcPorts") {}

const RpcPortsLive = Layer.effect(
  RpcPorts,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<MainPortLike>();
    return RpcPorts.of({
      accept: (port) => Effect.asVoid(Queue.offer(queue, port)),
      next: Queue.take(queue),
    });
  }),
);

type Listener = (event: Socket.WebSocketEvent) => void;

const portAsWebSocket = (port: MainPortLike): Socket.WebSocketLike => {
  const onMessage = new Map<Listener, (event: { readonly data: unknown }) => void>();
  const onClose = new Map<Listener, () => void>();
  let readyState = 1;
  port.addListener("close", () => {
    readyState = 3;
  });
  port.start();
  return {
    get readyState() {
      return readyState;
    },
    addEventListener(type, listener) {
      if (type === "message") {
        const wrapped = (event: { readonly data: unknown }) => listener({ type, data: event.data });
        onMessage.set(listener, wrapped);
        port.addListener("message", wrapped);
      } else if (type === "close") {
        const wrapped = () => listener({ type, code: 1000 });
        onClose.set(listener, wrapped);
        port.addListener("close", wrapped);
      }
    },
    removeEventListener(type, listener) {
      const message = onMessage.get(listener);
      if (type === "message" && message !== undefined) port.removeListener("message", message);
      const close = onClose.get(listener);
      if (type === "close" && close !== undefined) port.removeListener("close", close);
    },
    close: () => port.close(),
    send: (data) => port.postMessage(data),
  };
};

const SocketServerLive = Layer.effect(
  SocketServer.SocketServer,
  Effect.gen(function* () {
    const ports = yield* RpcPorts;
    return SocketServer.SocketServer.of({
      address: NetAddress.unixPathAddress("kladd-electron-ipc"),
      run: (handler) =>
        Effect.gen(function* () {
          const port = yield* ports.next;
          const socket = yield* Socket.fromWebSocket(
            Effect.acquireRelease(
              Effect.sync(() => portAsWebSocket(port)),
              (ws) => Effect.sync(() => ws.close()),
            ),
            { disableReconnects: true },
          );
          yield* Effect.forkScoped(Effect.ignoreCause(handler(socket), { log: true }));
        }).pipe(Effect.forever, Effect.scoped),
    });
  }),
);

/** Provides RpcServer.Protocol (for RpcServer.layer) and RpcPorts (to feed it ports). */
export const layerProtocol: Layer.Layer<RpcServer.Protocol | RpcPorts> =
  RpcServer.layerProtocolSocketServer.pipe(
    Layer.provide([SocketServerLive, RpcSerialization.layerJson]),
    Layer.provideMerge(RpcPortsLive),
  );
