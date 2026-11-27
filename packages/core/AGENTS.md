# @kladd/core

Use cases (`src/<feature>/`) and ports (`src/ports/`): the interfaces core needs from the outside world.
Imports: `@kladd/domain`, `effect`. No OS, files or network: reach those through a port.
Copy: `src/session/Sessions.ts` (use case) and `src/ports/ScreenCapture.ts` (port). Overlay placement beside the pill: `src/logging/LoggingOverlay.ts`.
Every port gets a test layer in `src/testing/index.ts`; tests use those layers (`src/session/Sessions.test.ts`). Wire a test as `UseCase.layer.pipe(Layer.provide(ports), Layer.provideMerge(ports the test reads back, like OverlayWindowsTest))`.
