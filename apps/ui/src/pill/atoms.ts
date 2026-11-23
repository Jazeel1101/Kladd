import { KladdClient } from "../rpc";

/** Pops up the pill's native menu (start/stop recording, Settings, Quit), drawn by main. */
export const openMenuAtom = KladdClient.mutation("OpenPillMenu");
