import * as NodeServices from "@effect/platform-node/NodeServices";
import { Recordings } from "@kladd/core";
import { IdsLive, RecordingStoreFile, StorageConfig } from "@kladd/infra";
import { app } from "electron";
import { Layer } from "effect";
import { ElectronAppLive } from "./app";
import { PlatformLive } from "./platform";
import { RpcServerLive } from "./rpc/server";
import { UpdaterLive } from "./updater";
import { MainWindowLive } from "./windows";

/**
 * The only place layers are wired together. Read bottom-up:
 * OS + infra implement core's ports -> core use cases -> RPC server -> windows.
 */
const StorageConfigLive = Layer.succeed(
  StorageConfig,
  StorageConfig.of({ dataDir: app.getPath("userData") }),
);

const CoreLive = Recordings.layer.pipe(
  Layer.provide([PlatformLive, RecordingStoreFile, IdsLive]),
  Layer.provide([StorageConfigLive, NodeServices.layer]),
);

export const MainLive = Layer.mergeAll(MainWindowLive, UpdaterLive).pipe(
  Layer.provide(ElectronAppLive),
  Layer.merge(RpcServerLive),
  Layer.provide(CoreLive),
);
