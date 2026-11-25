import { assert, describe, it } from "@effect/vitest";
import { allowRead, denyReadGlobs, type AllowReadInput } from "./AllowRead";
import { excludedApps, type TimelineEvent } from "./SessionFolder";

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
  ...overrides,
});

describe("allowRead", () => {
  it("allows the session folder and each focused app's Library data", () => {
    const rules = allowRead(
      input({
        events: [focus("Xcode", "com.apple.dt.Xcode"), focus("Word", "com.microsoft.Word")],
      }),
    );
    assert.deepStrictEqual(rules.allow, [
      `${home}/Library/**/Word`,
      `${home}/Library/**/Xcode`,
      `${home}/Library/**/com.apple.dt.Xcode`,
      `${home}/Library/**/com.microsoft.Word`,
      sessionDir,
    ]);
    assert.deepStrictEqual(rules.deny, denyReadGlobs);
  });

  it("never allows an excluded app, by bundle id or by name", () => {
    const rules = allowRead(
      input({
        events: [
          ...excludedApps.map((bundleId) => focus("1Password", bundleId)),
          focus("Messages", "com.apple.MobileSMS"),
        ],
      }),
    );
    assert.deepStrictEqual(rules.allow, [sessionDir]);
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
