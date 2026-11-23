# @kladd/core

Use cases (`src/<feature>/`) and ports (`src/ports/`): the interfaces core needs from the outside world.
Imports: `@kladd/domain`, `effect`. No OS, files or network: reach those through a port.
Copy: `src/recording/Recordings.ts` (use case) and `src/ports/ScreenCapture.ts` (port). Overlay placement: `src/logging/LoggingOverlay.ts`.
Every port gets a test layer in `src/testing/index.ts`; tests use those layers (`src/recording/Recordings.test.ts`).
