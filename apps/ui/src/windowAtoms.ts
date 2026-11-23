import { KladdClient } from "./rpc";

/** Show or hide one of Kladd's windows (WindowKind). Use with `{ payload: { kind } }`. */
export const showWindowAtom = KladdClient.mutation("ShowWindow");
export const hideWindowAtom = KladdClient.mutation("HideWindow");
