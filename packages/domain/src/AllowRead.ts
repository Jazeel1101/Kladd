import {
  deniedPathFragments,
  excludedApps,
  isDeniedPath,
  type TimelineEvent,
} from "./SessionFolder";

/** What the summary agent's read allow list is derived from. All paths absolute, no trailing `/`. */
export interface AllowReadInput {
  readonly sessionDir: string;
  readonly homeDir: string;
  readonly events: ReadonlyArray<TimelineEvent>;
}

/** Paths and globs the summary agent may read, and globs it may never read, which win. */
export interface ReadRules {
  readonly allow: ReadonlyArray<string>;
  readonly deny: ReadonlyArray<string>;
}

/** A path, or the folder at it, matches the deny list. */
const denied = (path: string): boolean => isDeniedPath(path) || isDeniedPath(`${path}/`);

/** Any character that would turn an app name into a wider glob. */
const globSyntax = /[*?[\]{}\\/]/;

/**
 * `deniedPathFragments` as globs, so that an allowed glob such as `~/Library/**\/<bundleId>` still
 * cannot reach into a denied folder like `~/Library/Containers/com.apple.<app>`.
 */
export const denyReadGlobs: ReadonlyArray<string> = deniedPathFragments.flatMap((fragment) =>
  fragment.endsWith("/") ? [`**${fragment}**`] : [`**${fragment}*`, `**${fragment}*/**`],
);

/**
 * The summary agent's read rules for one session, with no per-app code: the session folder and
 * `~/Library/**\/<bundleId or app name>` for each app in a `focus` event; minus the deny list and
 * excluded apps.
 */
export const allowRead = (input: AllowReadInput): ReadRules => {
  const library = `${input.homeDir}/Library`;
  const appGlobs = input.events.flatMap((event) =>
    event.type !== "focus" || excludedApps.includes(event.bundleId)
      ? []
      : [event.bundleId, event.app]
          .filter((name) => name.trim() !== "" && !globSyntax.test(name))
          .map((name) => `${library}/**/${name}`)
          .filter((glob) => !denied(glob)),
  );

  return {
    allow: [...new Set([input.sessionDir, ...appGlobs])].toSorted(),
    deny: denyReadGlobs,
  };
};
