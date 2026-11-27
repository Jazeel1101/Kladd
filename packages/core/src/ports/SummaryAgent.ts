import type { SummaryFailed } from "@kladd/domain";
import { Context, type Effect } from "effect";

/**
 * Port: an LLM agent that reads one finished session folder and writes its `summary.md`
 * (GLOSSARY: "oppsummering"). It may read Kladd's data folder and nothing else on the Mac, and
 * reach no server but its LLM's. One implementation per agent in packages/infra.
 * Test double: SummaryAgentTest in ../testing.
 */
export class SummaryAgent extends Context.Service<
  SummaryAgent,
  {
    /** Writes `summary.md` in `folder`; fails without the agent, its login, or the file. */
    readonly summarize: (folder: string) => Effect.Effect<void, SummaryFailed>;
  }
>()("kladd/core/SummaryAgent") {}
