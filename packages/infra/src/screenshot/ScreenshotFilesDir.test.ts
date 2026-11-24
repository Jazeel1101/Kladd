import * as NodeServices from "@effect/platform-node/NodeServices";
import { ScreenshotFiles } from "@kladd/core";
import { ScreenshotId } from "@kladd/domain";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { StorageConfig } from "../StorageConfig";
import { ScreenshotFilesDir } from "./ScreenshotFilesDir";

const inTempDir = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataDir = yield* fs.makeTempDirectoryScoped();
    return ScreenshotFilesDir.pipe(
      Layer.provideMerge(Layer.succeed(StorageConfig, StorageConfig.of({ dataDir }))),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

const id = ScreenshotId.make("019a5c1e-2b3f-7c4d-8e5f-6a7b8c9d0e1f");

describe("ScreenshotFilesDir", () => {
  it.effect("gives a PNG in dataDir/screenshots, and creates that directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dataDir } = yield* StorageConfig;
      const files = yield* ScreenshotFiles;
      const file = yield* files.file(id);
      assert.strictEqual(file, path.join(dataDir, "screenshots", `${id}.png`));
      assert.isTrue(yield* fs.exists(path.dirname(file)));
    }).pipe(Effect.provide(inTempDir)),
  );

  it.effect("fails with ScreenCaptureFailed when the directory can't be made", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dataDir } = yield* StorageConfig;
      // A file where the directory should be.
      yield* fs.writeFileString(path.join(dataDir, "screenshots"), "");
      const files = yield* ScreenshotFiles;
      const error = yield* Effect.flip(files.file(id));
      assert.strictEqual(error._tag, "ScreenCaptureFailed");
    }).pipe(Effect.provide(inTempDir)),
  );
});
