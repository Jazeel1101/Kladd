import { ScreenshotFiles } from "@kladd/core";
import type { ScreenshotId } from "@kladd/domain";
import { Effect, FileSystem, Layer, Path } from "effect";
import { StorageConfig } from "../StorageConfig";

/** Screenshots as `<dataDir>/screenshots/<id>.png`. Needs FileSystem and Path, like RecordingStoreFile. */
export const ScreenshotFilesDir = Layer.effect(
  ScreenshotFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join((yield* StorageConfig).dataDir, "screenshots");

    const file = Effect.fn("ScreenshotFilesDir.file")(function* (id: ScreenshotId) {
      yield* fs.makeDirectory(dir, { recursive: true });
      return path.join(dir, `${id}.png`);
    }, Effect.orDie);

    return ScreenshotFiles.of({ file });
  }),
);
