# @kladd/infra

Implementations of core ports that work on any OS: storage, IDs, LLM clients (BYOK).
Imports: `@kladd/core`, `@kladd/domain`, `effect`. Use Effect platform services (`FileSystem`, `Path`, `HttpClient`) that apps/desktop provides.
Copy: `src/session/SessionStoreFile.ts`, with a round-trip test like `SessionStoreFile.test.ts`.
OS-specific code goes in `packages/platform-<os>`.
