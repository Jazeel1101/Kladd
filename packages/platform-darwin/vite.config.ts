import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Not cached: vp can't see the files swift build reads, so a cache hit would replay a stale
      // build. swift build is incremental on its own. build.sh leaves out PermissionFlow without Xcode.
      "build:native": { command: "sh native/build.sh", cache: false },
      // The helper's writers on synthetic frames and files; needs no display or permission.
      "test:native": { command: "swift test --package-path native", cache: false },
    },
  },
});
