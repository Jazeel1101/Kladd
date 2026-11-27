import { makeAppAdapter } from "@kladd/domain";

/** Fallback for apps without an adapter. Its writing target is the default: app name and window title. */
export const Generic = makeAppAdapter({ id: "generic", bundleIds: [] });
