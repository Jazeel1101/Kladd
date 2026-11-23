import { defineConfig } from "vite-plus";

const generated = ["**/dist/**", "**/release/**", "**/routeTree.gen.ts"];

const kladdRules = {
  "kladd/no-effect-run": "error",
  "kladd/no-throw": "error",
  "kladd/no-try-catch": "error",
  "kladd/no-async": "error",
  "kladd/no-type-assertion": "error",
  "kladd/no-any": "error",
  "kladd/prefer-effect-fn": "error",
  "kladd/service-style": "error",
  "kladd/schema-errors": "error",
  "kladd/one-window-table": "error",
} as const;

const off = (rules: Record<string, unknown>): Record<string, "off"> =>
  Object.fromEntries(Object.keys(rules).map((rule) => [rule, "off"]));

const tests = ["**/*.test.ts", "**/*.test.tsx"];

export default defineConfig({
  // Lint and format config lives only here (vite-plus ignores per-package lint/fmt blocks).
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "./tools/lint/kladd.ts",
    ],
    ignorePatterns: generated,
    options: { typeAware: true, typeCheck: false },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-floating-promises": "error",
      ...kladdRules,
    },
    overrides: [
      // Composition root and transport plumbing may run and wire Effects.
      {
        files: ["apps/desktop/src/main/**", "packages/rpc-electron/**"],
        rules: { "kladd/no-effect-run": "off" },
      },
      { files: ["apps/desktop/src/main/windows.ts"], rules: { "kladd/one-window-table": "off" } },
      {
        files: tests,
        rules: {
          "kladd/no-effect-run": "off",
          "kladd/no-type-assertion": "off",
          "kladd/no-any": "off",
        },
      },
      // Build config and dev tooling are plain Node scripts, not app code.
      { files: ["tools/**", "**/scripts/**", "**/vite.config.ts"], rules: off(kladdRules) },
    ],
  },
  fmt: {
    ignorePatterns: generated,
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.test.{ts,tsx}"],
  },
  run: {
    cache: true,
    tasks: {
      // The one gate. Pre-commit and the Claude Code Stop hook both run this.
      check: {
        command: [
          "vp check --deny-warnings",
          "vp run -r typecheck",
          "depcruise apps packages --config .dependency-cruiser.cjs --output-type err-long",
          "knip",
          "sherif",
          "vp test",
        ],
        cache: false,
      },
    },
  },
});
