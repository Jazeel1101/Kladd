import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Not cached: vp can't see the files swift build reads, so a cache hit would replay a stale
      // build. swift build is incremental on its own.
      "build:native": { command: "swift build -c release --package-path native", cache: false },
    },
  },
});
