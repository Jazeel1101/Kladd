import type { ScreenCaptureFailed, ScreenshotId } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: where screenshots are saved. Implemented in packages/infra; apps/desktop also serves the
 * files to the UI from here. Test double: ScreenshotFilesTest in ../testing.
 */
export class ScreenshotFiles extends Context.Service<
  ScreenshotFiles,
  {
    /** The PNG file for `id`. Its directory exists once this succeeds; if it can't be made, fails. */
    readonly file: (id: ScreenshotId) => Effect.Effect<string, ScreenCaptureFailed>;
  }
>()("kladd/core/ScreenshotFiles") {}
