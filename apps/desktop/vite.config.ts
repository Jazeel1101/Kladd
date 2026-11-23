import { defineConfig, type UserConfig } from "vite-plus";

// Main and preload are bundled with everything they import (workspace packages, effect, ...).
// Only electron (provided at runtime) and package.json "dependencies" (electron-updater) stay external.
const shared = {
  platform: "node",
  fixedExtension: true,
  dts: false,
  deps: { neverBundle: ["electron"], onlyBundle: false },
} satisfies UserConfig["pack"];

export default defineConfig({
  pack: [
    { ...shared, entry: { index: "src/main/index.ts" }, outDir: "dist/main", format: "esm" },
    // Sandboxed preloads must be CommonJS.
    { ...shared, entry: { index: "src/preload/index.ts" }, outDir: "dist/preload", format: "cjs" },
  ],
});
