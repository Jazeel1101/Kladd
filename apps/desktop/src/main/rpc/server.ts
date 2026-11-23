import { KladdRpcs } from "@kladd/contract";
import { RpcChannel } from "@kladd/rpc-electron/channels";
import { RpcPorts, layerProtocol } from "@kladd/rpc-electron/server";
import { MessageChannelMain, ipcMain, type IpcMainEvent } from "electron";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";
import { isAppUrl } from "../windows";
import { RpcHandlersLive } from "./handlers";

/** Answers each renderer's connect request with a fresh MessagePort served by the RPC server. */
const IpcBridgeLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const ports = yield* RpcPorts;
    const context = yield* Effect.context<never>();
    const onConnect = (event: IpcMainEvent) => {
      if (event.senderFrame === null || !isAppUrl(event.senderFrame.url)) return;
      const { port1, port2 } = new MessageChannelMain();
      Effect.runForkWith(context)(ports.accept(port1));
      event.sender.postMessage(RpcChannel.port, null, [port2]);
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => ipcMain.on(RpcChannel.connect, onConnect)),
      () => Effect.sync(() => ipcMain.removeListener(RpcChannel.connect, onConnect)),
    );
  }),
);

export const RpcServerLive = RpcServer.layer(KladdRpcs).pipe(
  Layer.provide([RpcHandlersLive, IpcBridgeLive]),
  Layer.provide(layerProtocol),
);
