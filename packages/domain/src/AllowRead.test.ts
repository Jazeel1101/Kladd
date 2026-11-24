import { assert, describe, it } from "@effect/vitest";
import { allowRead, denyReadGlobs, type AllowReadInput } from "./AllowRead";
import { excludedApps, isDeniedPath, type TimelineEvent } from "./SessionFolder";

const home = "/Users/elev";
const sessionDir = `${home}/Library/Application Support/Kladd/recordings/2026-11-24_1402_abc`;

const focus = (app: string, bundleId: string): TimelineEvent => ({
  type: "focus",
  t: 1,
  app,
  bundleId,
  title: null,
});

const input = (overrides: Partial<AllowReadInput>): AllowReadInput => ({
  sessionDir,
  homeDir: home,
  events: [],
  files: [],
  repoRoots: [],
  ...overrides,
});

describe("allowRead", () => {
  it("allows the session folder, changed paths with their repo, and each focused app's Library data", () => {
    const rules = allowRead(
      input({
        events: [focus("Xcode", "com.apple.dt.Xcode"), focus("Word", "com.microsoft.Word")],
        files: [
          { t: 10, path: `${home}/Code/robot/src/main.c` },
          { t: 20, path: `${home}/Code/robot/README.md` },
          { t: 30, path: `${home}/Documents/Logg uke 47.docx` },
          { t: 40, path: `${home}/Library/Preferences/com.microsoft.Word.plist` },
        ],
        repoRoots: [`${home}/Code/robot`],
      }),
    );
    assert.deepStrictEqual(rules.allow, [
      `${home}/Code/robot`,
      `${home}/Documents/Logg uke 47.docx`,
      `${home}/Library/**/Word`,
      `${home}/Library/**/Xcode`,
      `${home}/Library/**/com.apple.dt.Xcode`,
      `${home}/Library/**/com.microsoft.Word`,
      sessionDir,
    ]);
    assert.deepStrictEqual(rules.deny, denyReadGlobs);
  });

  it("never allows a denied path, even inside an allowed repo root", () => {
    const rules = allowRead(
      input({
        files: [
          { t: 1, path: `${home}/.ssh/id_ed25519` },
          { t: 2, path: `${home}/.aws/credentials` },
          { t: 3, path: `${home}/Library/Caches/x/y` },
          { t: 4, path: `${home}/proj/.netrc` },
        ],
        repoRoots: [`${home}/.ssh`, `${home}/proj`],
      }),
    );
    assert.deepStrictEqual(rules.allow, [sessionDir]);
    assert.isTrue(rules.allow.every((path) => path === sessionDir || !isDeniedPath(path)));
  });

  it("never allows an excluded app, by bundle id or by name", () => {
    const rules = allowRead(
      input({
        events: [
          ...excludedApps.map((bundleId) => focus("1Password", bundleId)),
          focus("Messages", "com.apple.MobileSMS"),
        ],
        files: excludedApps.map((bundleId, t) => ({
          t,
          path: `${home}/Library/Group Containers/${bundleId}/data.sqlite`,
        })),
      }),
    );
    assert.deepStrictEqual(rules.allow, [sessionDir]);
  });

  it("drops repo roots that hold no kept change, or that would open up the home folder or Library", () => {
    const rules = allowRead(
      input({
        files: [{ t: 1, path: `${home}/Code/a/x.ts` }],
        repoRoots: [home, "/", `${home}/Library`, `${home}/Code/unrelated`, `${home}/Code/a`],
      }),
    );
    assert.deepStrictEqual(rules.allow, [`${home}/Code/a`, sessionDir]);
  });

  it("skips app names that would widen the glob, and duplicates", () => {
    const rules = allowRead(
      input({
        events: [focus("*", "com.x.app"), focus("a/b", "com.x.app"), focus("", "com.x.app")],
      }),
    );
    assert.deepStrictEqual(rules.allow, [`${home}/Library/**/com.x.app`, sessionDir]);
  });

  it("denies Apple containers an app glob would otherwise reach", () => {
    assert.include(denyReadGlobs, "**/Library/Containers/com.apple.*");
    assert.include(denyReadGlobs, "**/Library/Containers/com.apple.*/**");
    assert.include(denyReadGlobs, "**/.ssh/**");
    assert.include(denyReadGlobs, "**/com.apple.MobileSMS*/**");
  });
});
