import { Clips, LoggingOverlay, Screenshots, Sessions } from "@kladd/core";
import type { CaptureMode } from "@kladd/domain";
import { dialog } from "electron";
import { Context, Effect, Layer } from "effect";
import { captureErrorMessage } from "./globalShortcut";

/** The mode the pill starts sessions in. Auto is shown in the pill menu, but not offered yet. */
export const captureMode: CaptureMode = "manual";

/**
 * What the pill's buttons and menu do. Each shows its failure in a dialog, so none fails; one the
 * pill only offers in another state (ending a session that already ended) is a race, and ignored.
 */
export class PillActions extends Context.Service<
  PillActions,
  {
    readonly start: Effect.Effect<void>;
    readonly end: Effect.Effect<void>;
    readonly finishLogging: Effect.Effect<void>;
    readonly screenshot: Effect.Effect<void>;
    readonly clip: Effect.Effect<void>;
    readonly openLogging: Effect.Effect<void>;
  }
>()("kladd/desktop/PillActions") {}

const showError = (message: string) => Effect.sync(() => dialog.showErrorBox("Kladd", message));

export const PillActionsLive = Layer.effect(
  PillActions,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const screenshots = yield* Screenshots;
    const clips = yield* Clips;
    const logging = yield* LoggingOverlay;
    return PillActions.of({
      start: sessions.start(captureMode).pipe(
        Effect.asVoid,
        Effect.catchTag("SessionAlreadyOpen", () =>
          showError("A session is already open. End it, or finish its log, first."),
        ),
        Effect.catchTags({
          ScreenCapturePermissionDenied: (error) =>
            showError(captureErrorMessage(error._tag, "start the session")),
          ScreenCaptureFailed: (error) =>
            showError(captureErrorMessage(error._tag, "start the session")),
        }),
      ),
      end: sessions.end.pipe(
        Effect.asVoid,
        Effect.catchTag("NoActiveSession", () => Effect.void),
      ),
      finishLogging: sessions.finishLogging.pipe(
        Effect.asVoid,
        Effect.catchTag("NoEndedSession", () => Effect.void),
      ),
      screenshot: screenshots.take.pipe(
        Effect.catch((error) => showError(captureErrorMessage(error._tag, "take the screenshot"))),
      ),
      clip: clips.toggle.pipe(
        Effect.catch((error) => showError(captureErrorMessage(error._tag, "record the clip"))),
      ),
      openLogging: logging.open,
    });
  }),
);
