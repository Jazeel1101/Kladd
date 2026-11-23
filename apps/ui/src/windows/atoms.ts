import { KladdClient } from "../rpc";

/** Open a window the UI may open (domain OpenableWindow). Use with `{ payload: { kind } }`. */
export const showWindowAtom = KladdClient.mutation("ShowWindow");
/** Close a window the UI may close (domain ClosableWindow). Use with `{ payload: { kind } }`. */
export const hideWindowAtom = KladdClient.mutation("HideWindow");
