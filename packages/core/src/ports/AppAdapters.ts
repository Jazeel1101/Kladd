import type { AppAdapter } from "@kladd/domain";
import { Context } from "effect";

/**
 * Port: the registered app adapters. apps/desktop provides the list from @kladd/adapters, so core
 * never depends on individual apps. Test double: AppAdaptersTest in ../testing.
 */
export class AppAdapters extends Context.Service<
  AppAdapters,
  {
    readonly all: ReadonlyArray<AppAdapter>;
    readonly fallback: AppAdapter;
  }
>()("kladd/core/AppAdapters") {}
