import { Context } from "effect";

/** Where infra writes files. apps/desktop provides it from Electron's userData path. */
export class StorageConfig extends Context.Service<
  StorageConfig,
  {
    readonly dataDir: string;
    /** Kladd's version, written into every session folder's `session.json`. */
    readonly appVersion: string;
  }
>()("kladd/infra/StorageConfig") {}
