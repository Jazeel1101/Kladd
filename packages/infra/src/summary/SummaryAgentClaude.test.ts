import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Path } from "effect";
import { claudeOptions, deniedToolUse, type SummaryScope } from "./SummaryAgentClaude";

const scope: SummaryScope = {
  dataDir: "/Users/elev/Library/Application Support/Kladd",
  sessionDir: "/Users/elev/Library/Application Support/Kladd/sessions/2026-11-27_0900_a",
  home: "/Users/elev",
  user: "elev",
};

const verdicts = (calls: ReadonlyArray<[string, unknown]>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return calls.map(([name, input]) => deniedToolUse(path, scope, name, input) === null);
  }).pipe(Effect.provide(NodeServices.layer));

describe("deniedToolUse", () => {
  it.effect("reads anywhere in Kladd's data folder, and nowhere else", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* verdicts([
          ["Read", { file_path: "overview.md" }],
          ["Read", { file_path: `${scope.sessionDir}/clips/001/frames/3.0.jpg` }],
          ["Read", { file_path: "../2026-11-26_1400_b/summary.md" }],
          ["Read", { file_path: "../../../../.ssh/id_ed25519" }],
          ["Read", { file_path: "/etc/hosts" }],
          ["Read", { file_path: "~/.zshrc" }],
          ["Read", { file_path: "/Users/elev/Library/Application Support/Kladd2/x" }],
        ]),
        [true, true, true, false, false, false, false],
      );
    }),
  );

  it.effect("searches only inside the data folder", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* verdicts([
          ["Grep", { pattern: "OneNote" }],
          ["Glob", { pattern: "screenshots/*.json" }],
          ["Glob", { pattern: "**/*.md", path: "/Users/elev" }],
          ["Glob", { pattern: "/Users/elev/**/*.pdf" }],
          ["Glob", { pattern: "../../../../Documents/**" }],
          ["Grep", { pattern: "password", path: "~" }],
        ]),
        [true, true, false, false, false, false],
      );
    }),
  );

  it.effect("writes summary.md in the session folder only, and nothing else runs", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* verdicts([
          ["Write", { file_path: "summary.md" }],
          ["Edit", { file_path: `${scope.sessionDir}/summary.md` }],
          ["Write", { file_path: "overview.md" }],
          ["Write", { file_path: "../summary.md" }],
          ["Bash", { command: "jq . session.json" }],
          ["mcp__kladd__frame_at", { clip: "001", t: 2 }],
          ["WebFetch", { url: "https://example.com" }],
          ["NotebookEdit", { notebook_path: "x.ipynb" }],
          ["Read", "not an object"],
        ]),
        [true, true, false, false, true, true, false, false, false],
      );
    }),
  );
});

describe("claudeOptions", () => {
  const options = claudeOptions(scope, "/opt/homebrew/bin/claude", {});

  it("runs the student's claude in the session folder without their settings", () => {
    assert.strictEqual(options.pathToClaudeCodeExecutable, "/opt/homebrew/bin/claude");
    assert.strictEqual(options.cwd, scope.sessionDir);
    assert.deepStrictEqual(options.settingSources, []);
    assert.strictEqual(options.permissionPrompts, "none");
    assert.strictEqual(options.persistSession, false);
    assert.deepStrictEqual(options.tools, ["Read", "Glob", "Grep", "Bash", "Write", "Edit"]);
  });

  it("sandboxes Bash to the data folder with no network, and fails without a sandbox", () => {
    assert.deepStrictEqual(options.sandbox, {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        denyRead: ["/Users", "/Volumes"],
        allowRead: [scope.dataDir],
        denyWrite: [scope.dataDir],
      },
      network: { allowedDomains: [], strictAllowlist: true },
    });
  });

  it("gives Claude Code only its own environment, with telemetry off", () => {
    assert.strictEqual(options.env?.["DISABLE_TELEMETRY"], "1");
    assert.strictEqual(options.env?.["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1");
    assert.isUndefined(options.env?.["ANTHROPIC_API_KEY"]);
  });
});
