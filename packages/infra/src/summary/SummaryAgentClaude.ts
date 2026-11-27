import {
  type HookCallback,
  type Options,
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { SummaryAgent, VideoFrames } from "@kladd/core";
import {
  SummaryFailed,
  clipFiles,
  clipFrameName,
  clipsFolder,
  sessionFiles,
  summaryInstructions,
} from "@kladd/domain";
import {
  Config,
  Effect,
  Exit,
  FiberSet,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { z } from "zod";
import { StorageConfig } from "../StorageConfig";

/** Where the agent may go: all absolute, without a trailing `/`. */
export interface SummaryScope {
  /** Kladd's data folder: the only place it may read. */
  readonly dataDir: string;
  /** The session it summarizes, inside dataDir: its working folder. */
  readonly sessionDir: string;
  /** The student's home folder and user name: Claude Code finds their login with them. */
  readonly home: string;
  readonly user: string;
}

/** Where the student's `claude` may be: the native installer's, the old npm-local one's, Homebrew's. */
const claudeLocations = (home: string): ReadonlyArray<string> => [
  `${home}/.local/bin/claude`,
  `${home}/.claude/local/claude`,
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

/** The model, on the student's plan: good with images, and easy on its limits. */
const model = "sonnet";

const frameTool = "mcp__kladd__frame_at";

/** How long a summary may take before Kladd gives up on it. */
const summaryTimeout = "15 minutes";

const ToolInput = Schema.Struct({
  file_path: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
});
const decodeToolInput = Schema.decodeUnknownOption(ToolInput);

/**
 * How the student's own Claude Code reaches its model when not through its keychain login: the
 * `env` keys of `~/.claude/settings.json` that set a proxy, key or token, and none of the rest.
 * Claude Code takes a number there too, so a numeric token doesn't drop the proxy with it.
 */
const ConnectionValue = Schema.Union([Schema.String, Schema.Finite]);
const decodeClaudeSettings = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      env: Schema.optional(
        Schema.Struct({
          ANTHROPIC_BASE_URL: Schema.optional(ConnectionValue),
          ANTHROPIC_AUTH_TOKEN: Schema.optional(ConnectionValue),
          ANTHROPIC_API_KEY: Schema.optional(ConnectionValue),
          ANTHROPIC_CUSTOM_HEADERS: Schema.optional(ConnectionValue),
        }),
      ),
    }),
  ),
);
export type ClaudeConnection = Readonly<Record<string, string>>;

/** The connection in the text of the student's settings file; none when Kladd can't read it. */
export const connectionFrom = (settings: string): ClaudeConnection =>
  Option.match(decodeClaudeSettings(settings), {
    onNone: () => ({}),
    onSome: ({ env }) =>
      Object.fromEntries(Object.entries(env ?? {}).map(([key, value]) => [key, String(value)])),
  });

const inside = (dir: string, file: string) => file === dir || file.startsWith(`${dir}/`);

/**
 * Why the agent may not make this tool call, or null when it may: it reads in `scope.dataDir`
 * only, and writes `summary.md` only. Kladd checks every call itself, so a wrong permission rule
 * can't open anything. It has no tool that runs commands.
 */
export const deniedToolUse = (
  path: Path.Path,
  scope: SummaryScope,
  toolName: string,
  toolInput: unknown,
): string | null => {
  if (toolName === frameTool) return null;
  const input = Option.getOrUndefined(decodeToolInput(toolInput));
  if (input === undefined) return `Kladd could not read the input of ${toolName}.`;
  // Claude Code expands `~` itself, so a path starting with it is never relative to the folder.
  const resolve = (file: string) =>
    file.startsWith("~") ? null : path.resolve(scope.sessionDir, file);
  const readable = (file: string | undefined) => {
    const resolved = resolve(file ?? ".");
    return resolved !== null && inside(scope.dataDir, resolved);
  };
  switch (toolName) {
    case "Read":
      return readable(input.file_path) ? null : `Read only files in ${scope.dataDir}.`;
    case "Grep":
      // Its pattern is matched against file contents, so only its path is a path.
      return readable(input.path) ? null : `Search only in ${scope.dataDir}.`;
    case "Glob":
      return readable(input.path) &&
        (input.pattern === undefined ||
          (!input.pattern.startsWith("/") && !input.pattern.startsWith("~")) ||
          readable(input.pattern)) &&
        !(input.pattern ?? "").split("/").includes("..")
        ? null
        : `Search only in ${scope.dataDir}.`;
    case "Write":
    case "Edit":
      return input.file_path !== undefined &&
        resolve(input.file_path) === path.join(scope.sessionDir, sessionFiles.summary)
        ? null
        : `Write only ${sessionFiles.summary} in this folder.`;
    default:
      return `${toolName} is not available.`;
  }
};

/**
 * Claude Code's options for one summary: the student's own `claude`, login and connection, none of
 * their other settings, and nothing to reach but the session's data folder and their model's API.
 * docs/internals/summary-agent.md says why each is set.
 */
export const claudeOptions = (
  scope: SummaryScope,
  claude: string,
  connection: ClaudeConnection,
  extra: Pick<Options, "mcpServers" | "hooks" | "abortController">,
): Options => {
  const summary = `${scope.sessionDir}/${sessionFiles.summary}`;
  return {
    ...extra,
    pathToClaudeCodeExecutable: claude,
    model,
    cwd: scope.sessionDir,
    additionalDirectories: [scope.dataDir],
    systemPrompt: summaryInstructions,
    settingSources: [],
    strictMcpConfig: true,
    skills: [],
    persistSession: false,
    maxTurns: 100,
    // No Bash: a shell could read the whole system and write to temp folders.
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    allowedTools: [frameTool],
    disallowedTools: ["WebFetch", "WebSearch"],
    permissionMode: "dontAsk",
    permissionPrompts: "none",
    settings: {
      permissions: {
        // `//` starts an absolute path in a permission rule.
        allow: [`Read(/${scope.dataDir}/**)`, `Edit(/${summary})`, `Write(/${summary})`],
        deny: ["WebFetch", "WebSearch"],
      },
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        // Every user's files and every other disk, should any command run after all.
        denyRead: ["/Users", "/Volumes"],
        allowRead: [scope.dataDir],
        denyWrite: [scope.dataDir],
      },
      network: { allowedDomains: [], strictAllowlist: true },
    },
    // Replaces the environment: nothing of Kladd's or the student's shell reaches the agent.
    env: {
      ...connection,
      HOME: scope.home,
      USER: scope.user,
      LOGNAME: scope.user,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    },
  };
};

const failed = (reason: string) => new SummaryFailed({ reason });

/**
 * SummaryAgent with the student's own Claude Code (`@anthropic-ai/claude-agent-sdk` running their
 * installed `claude`), so it runs on their login and plan; Kladd holds no key. Fails, for
 * Sessions to log, without `claude` or a login.
 */
export const SummaryAgentClaude = Layer.effect(
  SummaryAgent,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const frames = yield* VideoFrames;
    const { dataDir } = yield* StorageConfig;
    // Read per summary, so a missing one fails the summary rather than Kladd's start.
    const account = Config.all({
      home: Config.NonEmptyString("HOME"),
      user: Config.NonEmptyString("USER"),
    }).pipe(Effect.mapError(() => failed("HOME or USER is not set")));
    // Runs frame_at and the tool-use check, which the SDK calls as Promises, in this layer.
    const run = yield* FiberSet.makeRuntimePromise();

    const findClaude = Effect.fn("SummaryAgentClaude.findClaude")(function* (home: string) {
      for (const location of claudeLocations(home)) {
        if (yield* fs.exists(location).pipe(Effect.orElseSucceed(() => false))) return location;
      }
      return yield* failed("Claude Code is not installed");
    });

    const frameAt = (folder: string) =>
      tool(
        "frame_at",
        "Saves the frame of a clip's screen.mp4 at time t (seconds since that clip started) as a JPEG, and returns its path to Read.",
        { clip: z.string().regex(/^\d{3}$/), t: z.number().min(0) },
        ({ clip, t }) =>
          run(
            Effect.gen(function* () {
              const file = path.join(clipsFolder, clip, clipFiles.frames, clipFrameName(t));
              yield* frames.frameAt(
                path.join(folder, clipsFolder, clip, clipFiles.video),
                t,
                path.join(folder, file),
              );
              return { content: [{ type: "text" as const, text: file }] };
            }).pipe(
              Effect.catchTag("VideoFrameFailed", (error) =>
                Effect.succeed({
                  isError: true,
                  content: [{ type: "text" as const, text: error.reason }],
                }),
              ),
            ),
          ),
      );

    const summarize = Effect.fn("SummaryAgentClaude.summarize")(function* (folder: string) {
      const { home, user } = yield* account;
      const claude = yield* findClaude(home);
      // Without the file, or with one Kladd can't read, Claude Code falls back to its keychain login.
      const connection = connectionFrom(
        yield* fs
          .readFileString(path.join(home, ".claude", "settings.json"))
          .pipe(Effect.orElseSucceed(() => "")),
      );
      const scope: SummaryScope = { dataDir, sessionDir: folder, home, user };
      const check: HookCallback = (input) => {
        const reason =
          input.hook_event_name === "PreToolUse"
            ? deniedToolUse(path, scope, input.tool_name, input.tool_input)
            : null;
        return Promise.resolve(
          reason === null
            ? {}
            : {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: reason,
                },
              },
        );
      };
      // Stops Claude Code when the summary ends early (interrupted or timed out), then removes the
      // `.claude/` it leaves in its working folder: the session folder is Kladd's. A summary.md
      // from a run that failed goes too, so the folder stays unfinished and is tried again.
      const abortController = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller, exit) =>
          Effect.sync(() => controller.abort()).pipe(
            Effect.andThen(
              fs.remove(path.join(folder, ".claude"), { recursive: true, force: true }),
            ),
            Effect.andThen(
              Exit.isFailure(exit)
                ? fs.remove(path.join(folder, sessionFiles.summary), { force: true })
                : Effect.void,
            ),
            Effect.ignore,
          ),
      );
      const options = claudeOptions(scope, claude, connection, {
        abortController,
        mcpServers: { kladd: createSdkMcpServer({ name: "kladd", tools: [frameAt(folder)] }) },
        hooks: { PreToolUse: [{ hooks: [check] }] },
      });

      const result = yield* Stream.fromAsyncIterable(
        query({ prompt: "Summarize this session.", options }),
        (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
      ).pipe(
        Stream.filter((message) => message.type === "result"),
        Stream.runLast,
        Effect.timeoutOrElse({
          duration: summaryTimeout,
          orElse: () => Effect.fail(failed(`no summary after ${summaryTimeout}`)),
        }),
      );
      if (Option.isNone(result)) return yield* failed("Claude Code ended without a result");
      const end = result.value;
      if (end.subtype !== "success" || end.is_error) {
        return yield* failed(end.subtype === "success" ? end.result : end.errors.join("; "));
      }
      const written = yield* fs
        .exists(path.join(folder, sessionFiles.summary))
        .pipe(Effect.orElseSucceed(() => false));
      if (!written) return yield* failed(`Claude Code wrote no ${sessionFiles.summary}`);
    }, Effect.scoped);

    return SummaryAgent.of({ summarize });
  }),
);
