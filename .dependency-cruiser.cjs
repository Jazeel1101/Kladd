// @ts-check
/**
 * The package graph (see AGENTS.md). Every rule's `comment` is the fix: depcruise prints it on violation.
 * Adding a package: ask the user first, then add it to `packages` below and give it an AGENTS.md.
 */

/**
 * @typedef {{ dir: string, workspace: string[], npm: string[] | "any", node: boolean, hint: string }} PackageRule
 * @type {Record<string, PackageRule>}
 */
const packages = {
  domain: {
    dir: "packages/domain",
    workspace: [],
    npm: ["effect"],
    node: false,
    hint: "domain is the innermost layer: schemas, branded IDs, tagged errors and pure functions only. Move code that needs other packages into core.",
  },
  contract: {
    dir: "packages/contract",
    workspace: ["domain"],
    npm: ["effect"],
    node: false,
    hint: "contract only describes RPCs with schemas from domain. Implementations go in apps/desktop/src/main/rpc/handlers.ts.",
  },
  core: {
    dir: "packages/core",
    workspace: ["domain"],
    npm: ["effect"],
    node: false,
    hint: "core never touches the OS, files or network. Define a port (Context.Service) in packages/core/src/ports and implement it as a Layer in packages/infra or packages/platform-<os>.",
  },
  infra: {
    dir: "packages/infra",
    workspace: ["core", "domain"],
    npm: ["effect"],
    node: false,
    hint: "infra implements core's ports with platform-neutral Effect services (FileSystem, HttpClient, ...). OS-specific code goes in packages/platform-<os>; wiring goes in apps/desktop.",
  },
  "platform-darwin": {
    dir: "packages/platform-darwin",
    workspace: ["core", "domain"],
    npm: "any",
    node: true,
    hint: "platform-darwin implements core's ports for macOS. It must not depend on infra, contract or apps.",
  },
  "rpc-electron": {
    dir: "packages/rpc-electron",
    workspace: [],
    npm: ["effect"],
    node: false,
    hint: "rpc-electron is only the MessagePort transport. Keep it free of app code, electron and node imports (use structural types, see src/server.ts).",
  },
  ui: {
    dir: "apps/ui",
    workspace: ["contract", "domain", "rpc-electron"],
    npm: "any",
    node: false,
    hint: "ui may not import core, infra or platform packages. Add an Rpc to packages/contract and call it through KladdClient (apps/ui/src/rpc.ts). See packages/contract/AGENTS.md.",
  },
  desktop: {
    dir: "apps/desktop",
    workspace: ["contract", "core", "domain", "infra", "platform-darwin", "rpc-electron"],
    npm: "any",
    node: true,
    hint: "desktop wires packages together but never imports apps/ui (it loads the built UI from disk).",
  },
};

const npmTypes = [
  "npm",
  "npm-dev",
  "npm-optional",
  "npm-peer",
  "npm-bundled",
  "npm-no-pkg",
  "npm-unknown",
];
const tests = "\\.test\\.tsx?$";
const dirs = Object.values(packages).map((p) => p.dir.replace(/^(apps|packages)\//, ""));

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
const perPackage = Object.entries(packages).flatMap(([name, p]) => {
  const self = p.dir;
  const allowedDirs = [self, ...p.workspace.map((w) => packages[w]?.dir ?? `packages/${w}`)];
  const allowedList =
    p.workspace.length === 0
      ? "nothing from the workspace"
      : p.workspace.map((w) => `@kladd/${w}`).join(", ");
  /** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
  const rules = [
    {
      name: `${name}-workspace-imports`,
      severity: "error",
      comment: `${name} may import ${allowedList}. ${p.hint}`,
      from: { path: `^${self}/` },
      to: { path: "^(apps|packages)/", pathNot: `^(${allowedDirs.join("|")})/` },
    },
  ];
  if (p.npm !== "any") {
    rules.push({
      name: `${name}-npm-imports`,
      severity: "error",
      comment: `${name} may only import these npm packages: ${p.npm.join(", ")}. ${p.hint}`,
      from: { path: `^${self}/`, pathNot: tests },
      to: { dependencyTypes: npmTypes, pathNot: `node_modules/(${p.npm.join("|")})/` },
    });
  }
  if (!p.node) {
    rules.push({
      name: `${name}-no-node`,
      severity: "error",
      comment: `${name} may not import node:* modules. ${p.hint}`,
      from: { path: `^${self}/` },
      to: { dependencyTypes: ["core"] },
    });
  }
  return rules;
});

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    ...perPackage,
    {
      name: "unknown-package",
      severity: "error",
      comment: `Not an approved package. Approved: ${dirs.join(", ")}. Put the code in one of them (see AGENTS.md). A new package needs the user's approval and an entry in .dependency-cruiser.cjs. Never add "shared" or "utils" packages.`,
      from: {
        path: "^(apps|packages)/",
        pathNot: `^(${Object.values(packages)
          .map((p) => p.dir)
          .join("|")})/`,
      },
      to: {},
    },
    {
      name: "ui-no-electron",
      severity: "error",
      comment:
        "ui runs in a sandboxed renderer without electron or Node. Do the work in the main process behind an Rpc (packages/contract) and call it through KladdClient.",
      from: { path: "^apps/ui/" },
      to: { path: "node_modules/electron/" },
    },
    {
      name: "ui-rpc-client-only",
      severity: "error",
      comment:
        'ui may only import "@kladd/rpc-electron/client". The server side belongs to apps/desktop.',
      from: { path: "^apps/ui/" },
      to: {
        path: "^packages/rpc-electron/src/",
        pathNot: "^packages/rpc-electron/src/client\\.ts$",
      },
    },
    {
      name: "no-relative-cross-package",
      severity: "error",
      comment:
        'Import other workspace packages by name ("@kladd/core"), never by relative path. Add it to package.json with "workspace:*" if it is missing.',
      from: { path: "^(apps|packages)/([^/]+)/" },
      to: { path: "^(apps|packages)/", pathNot: "^$1/$2/", dependencyTypes: ["local"] },
    },
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular import. Move the shared piece to the module both depend on (often packages/domain) or invert it with a port in packages/core/src/ports.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        'Cannot resolve this import. Workspace package? Add "@kladd/<name>": "workspace:*" to this package\'s package.json and run pnpm install. Deep import ("@kladd/x/src/...")? Use what the package\'s "exports" offers.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "not-to-undeclared",
      severity: "error",
      comment:
        "This npm package isn't in the importing package's package.json. Add it there (shared versions go in the pnpm-workspace.yaml catalog, referenced as \"catalog:\").",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|release)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".d.ts"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
