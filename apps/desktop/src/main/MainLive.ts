import * as NodeServices from "@effect/platform-node/NodeServices";
import { Generic, appAdapters } from "@kladd/adapters";
import { AppAdapters, LoggingOverlay, Recordings, Screenshots } from "@kladd/core";
import { IdsLive, RecordingStoreFile, ScreenshotFilesDir, StorageConfig } from "@kladd/infra";
import { app } from "electron";
import { Layer } from "effect";
import { ElectronAppLive } from "./app";
import { PillMenuLive } from "./pillMenu";
import { PlatformLive } from "./platform";
import { RpcServerLive } from "./rpc/server";
import { ScreenshotProtocolLive } from "./screenshotProtocol";
import { ScreenshotShortcutLive } from "./screenshotShortcut";
import { UpdaterLive } from "./updater";
import { OverlayWindowsLive, PillLive } from "./windows";

/**
 * The only place layers are wired together. Read bottom-up:
 * Electron + OS + infra implement core's ports -> core use cases -> RPC server + pill.
 */
const StorageConfigLive = Layer.succeed(
  StorageConfig,
  StorageConfig.of({ dataDir: app.getPath("userData"), appVersion: app.getVersion() }),
);

const AppAdaptersLive = Layer.succeed(
  AppAdapters,
  AppAdapters.of({ all: appAdapters, fallback: Generic }),
);

/** Ports implemented in this app: they need Electron, which only apps/desktop may import. */
const ElectronPortsLive = OverlayWindowsLive.pipe(Layer.provide(ElectronAppLive));

const CoreLive = Layer.mergeAll(Recordings.layer, Screenshots.layer).pipe(
  Layer.provideMerge(LoggingOverlay.layer),
  Layer.provideMerge(ScreenshotFilesDir),
  Layer.provide([PlatformLive, RecordingStoreFile, IdsLive, AppAdaptersLive]),
  Layer.provideMerge(ElectronPortsLive),
  // NodeServices also gives PlatformLive its ChildProcessSpawner (the macOS capture helper).
  Layer.provide([StorageConfigLive, NodeServices.layer]),
);

export const MainLive = Layer.mergeAll(
  PillLive,
  UpdaterLive,
  RpcServerLive,
  ScreenshotShortcutLive,
  ScreenshotProtocolLive,
).pipe(Layer.provide(PillMenuLive), Layer.provideMerge(CoreLive));
