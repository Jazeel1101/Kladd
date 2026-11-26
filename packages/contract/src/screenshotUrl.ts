import type { Screenshot } from "@kladd/domain";

/**
 * The URL scheme main serves screenshot files on (apps/desktop/src/main/screenshotProtocol.ts), since
 * the sandboxed UI can't read files. apps/ui/index.html allows it as an image source.
 */
export const screenshotScheme = "kladd-screenshot";

/** `kladd-screenshot://<session id>/<screenshot id>`: the session names the folder it is in. */
export const screenshotUrl = ({ session, id }: Pick<Screenshot, "session" | "id">): string =>
  `${screenshotScheme}://${session}/${id}`;
