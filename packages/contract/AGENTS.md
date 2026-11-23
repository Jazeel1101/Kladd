# @kladd/contract

`KladdRpcs`: the full list of calls ui can make to the main process.
Imports: `@kladd/domain`, `effect`.
Copy an `Rpc.make(...)` entry in `src/KladdRpcs.ts`; use domain schemas for payload, success and error.
Then implement it in `apps/desktop/src/main/rpc/handlers.ts` and call it from ui via `KladdClient` (`apps/ui/src/rpc.ts`).
