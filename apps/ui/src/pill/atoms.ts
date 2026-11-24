import { KladdClient } from "../rpc";

/** Pops up the pill's native menu (start/stop recording, Settings, Quit), drawn by main. */
export const openMenuAtom = KladdClient.mutation("OpenPillMenu");
/** Moves the pill window while the user drags the notch. Use with `{ payload: { position } }`. */
export const movePillAtom = KladdClient.mutation("MovePill");
/** Lets clicks through the pill window's empty space. Use with `{ payload: { clickThrough } }`. */
export const setClickThroughAtom = KladdClient.mutation("SetPillClickThrough");
/** Tells main where ⌃⇧C screenshots land in the open pill. Use with `{ payload: { slot } }`. */
export const setScreenshotSlotAtom = KladdClient.mutation("SetScreenshotSlot");
