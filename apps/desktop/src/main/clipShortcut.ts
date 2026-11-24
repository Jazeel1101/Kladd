import { Clips } from "@kladd/core";
import { Effect, Layer } from "effect";
import { captureErrorMessage, registerShortcut } from "./globalShortcut";

/** ⌥⇧C anywhere during a work session: start a clip, or stop the one recording. */
export const ClipShortcutLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const clips = yield* Clips;
    yield* registerShortcut(
      "Alt+Shift+C",
      clips.toggle,
      (error) => captureErrorMessage(error._tag, "record the clip"),
      "clips",
    );
  }),
);
