import type { AppAdapter } from "@kladd/domain";
import { OneNote } from "./OneNote";

export { Generic } from "./Generic";

/** Every app with its own adapter. Adding an app: docs/operations/adding-app-support.md. */
export const appAdapters: ReadonlyArray<AppAdapter> = [OneNote];
