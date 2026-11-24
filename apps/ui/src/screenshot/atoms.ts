import { Effect, Stream } from "effect";
import { KladdClient } from "../rpc";

/** The screenshot in flight and the ones in the tray, updated live: ⌃⇧C is handled in main. */
export const screenshotTrayAtom = KladdClient.runtime.atom(
  Stream.unwrap(KladdClient.use((client) => Effect.succeed(client("WatchScreenshots", undefined)))),
);

/** Tell main the flying screenshot reached the tray. Use with `{ payload: { id } }`. */
export const landScreenshotAtom = KladdClient.mutation("LandScreenshot");
