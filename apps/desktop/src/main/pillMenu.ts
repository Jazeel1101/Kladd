import { Clips, LoggingOverlay, OverlayWindows, Sessions } from "@kladd/core";
import { sessionState } from "@kladd/domain";
import { Menu, type MenuItemConstructorOptions, app } from "electron";
import { Context, Effect, Layer, Option, Stream } from "effect";
import { PillActions, captureMode } from "./pillActions";

/** The pill's native menu: what the pill's state allows, the capture mode, Settings, Quit. */
export class PillMenu extends Context.Service<PillMenu, { readonly open: Effect.Effect<void> }>()(
  "kladd/desktop/PillMenu",
) {}

export const PillMenuLive = Layer.effect(
  PillMenu,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const clips = yield* Clips;
    const actions = yield* PillActions;
    const windows = yield* OverlayWindows;
    const logging = yield* LoggingOverlay;
    const context = yield* Effect.context<never>();
    // Menu clicks are Electron callbacks, so each action is forked on the app's runtime.
    const run = (effect: Effect.Effect<void>) => () => Effect.runForkWith(context)(effect);

    const open = Effect.gen(function* () {
      const state = Option.map(yield* sessions.current, sessionState);
      const clip = Option.flatten(yield* Stream.runHead(clips.changes));
      const forState: ReadonlyArray<MenuItemConstructorOptions> = Option.match(state, {
        // Auto mode is coming; until then the mode is shown, not chosen.
        onNone: () => [
          { label: "Start session", click: run(actions.start) },
          { type: "separator" },
          { label: "Manual", type: "radio", checked: captureMode === "manual" },
          { label: "Automatic (coming later)", type: "radio", enabled: false },
        ],
        onSome: (now) =>
          now === "active"
            ? [
                {
                  label: "Take screenshot",
                  accelerator: "Control+Shift+C",
                  click: run(actions.screenshot),
                },
                {
                  label: Option.isSome(clip) ? "Stop clip" : "Start clip",
                  accelerator: "Alt+Shift+C",
                  click: run(actions.clip),
                },
                { type: "separator" },
                { label: "End session", click: run(actions.end) },
              ]
            : [{ label: "Done logging", click: run(actions.finishLogging) }],
      });
      const menu = Menu.buildFromTemplate([
        ...forState,
        { type: "separator" },
        // Opens it in any state: for trying app adapters in the app the user is in.
        { label: "Show logging overlay", click: run(logging.open) },
        { type: "separator" },
        { label: "Settings…", click: run(windows.show("settings")) },
        { label: "Quit Kladd", click: () => app.quit() },
      ]);
      menu.popup();
    }).pipe(Effect.withSpan("PillMenu.open"));

    return PillMenu.of({ open });
  }),
);
