import { KladdClient } from "../rpc";

/** Pops up the pill's native menu (the session's actions, capture mode, Settings, Quit), drawn by main. */
export const openMenuAtom = KladdClient.mutation("OpenPillMenu");
/** Moves the pill window while the user drags the notch. Use with `{ payload: { position } }`. */
export const movePillAtom = KladdClient.mutation("MovePill");
/** Tells main where the notch rests, or null while it moves. Use with `{ payload: { dock } }`. */
export const setPillDockAtom = KladdClient.mutation("SetPillDock");
/** Tells main where ⌃⇧C screenshots land in the pill's open tray. Use with `{ payload: { slot } }`. */
export const setScreenshotSlotAtom = KladdClient.mutation("SetScreenshotSlot");
