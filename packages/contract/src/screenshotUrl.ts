import type { ScreenshotId } from "@kladd/domain";

/**
 * The URL scheme main serves screenshot files on (apps/desktop/src/main/screenshotProtocol.ts), since
 * the sandboxed UI can't read files. apps/ui/index.html allows it as an image source.
 */
export const screenshotScheme = "kladd-screenshot";

export const screenshotUrl = (id: ScreenshotId): string => `${screenshotScheme}://${id}`;
