/**
 * Kladd's own lint rules. Wired up (and scoped per path) in the root vite.config.ts `lint` block.
 * Every message says how to fix the problem, because agents act on the message alone.
 * Import plugin helpers from vite-plus/lint/plugins (not @oxlint/plugins) so they match the bundled oxlint.
 */
import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

/** `Obj.prop` → "Obj.prop"; anything else → undefined. */
const memberPath = (node: ESTree.Node): string | undefined => {
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return undefined;
  return `${node.object.name}.${node.property.name}`;
};

const WIRING = "apps/desktop/src/main/MainLive.ts";

const noEffectRun = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        const path = memberPath(node);
        if (path === undefined) return;
        const [object = "", property = ""] = path.split(".");
        const forbidden =
          (object === "Effect" && (property.startsWith("run") || property === "provide")) ||
          (object === "Layer" && (property.startsWith("provide") || property === "launch")) ||
          object === "ManagedRuntime" ||
          object === "NodeRuntime";
        if (!forbidden) return;
        context.report({
          node,
          message: `\`${path}\` runs or wires the app, which only apps/desktop/src/main may do. Leave the requirement in the Effect's type (R) and provide it in ${WIRING}. Tests may provide layers.`,
        });
      },
    };
  },
});

const noThrow = defineRule({
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          message:
            "Don't throw. Fail with a tagged error instead: `return yield* new MyError({ ... })`, with MyError defined via Schema.TaggedError in packages/domain (example: packages/domain/src/RecordingSession.ts).",
        });
      },
    };
  },
});

const noTryCatch = defineRule({
  create(context) {
    return {
      TryStatement(node) {
        context.report({
          node,
          message:
            "Don't use try/catch. Wrap code that can throw in Effect.try / Effect.tryPromise and turn the failure into a tagged error, then handle it with Effect.catchTag.",
        });
      },
    };
  },
});

const asyncMessage =
  "Don't use async/await. Write an Effect with Effect.gen / Effect.fn and `yield*`; wrap Promise APIs with Effect.tryPromise.";

const noAsync = defineRule({
  create(context) {
    const checkFunction = (node: ESTree.Function | ESTree.ArrowFunctionExpression) => {
      if (node.async) context.report({ node, message: asyncMessage });
    };
    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      AwaitExpression(node) {
        context.report({ node, message: asyncMessage });
      },
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "Promise") return;
        context.report({
          node,
          message:
            "Don't create Promises. Wrap callback APIs with Effect.callback (example: packages/rpc-electron/src/client.ts).",
        });
      },
    };
  },
});

const assertionMessage =
  "Don't cast with `as`. Decode unknown data with Schema.decodeUnknownEffect, narrow with a type guard, or fix the type where it is created. (`as const` and casts in *.test.ts files are allowed.)";

const noTypeAssertion = defineRule({
  create(context) {
    return {
      TSAsExpression(node) {
        const type = node.typeAnnotation;
        const isConst =
          type.type === "TSTypeReference" &&
          type.typeName.type === "Identifier" &&
          type.typeName.name === "const";
        if (!isConst) context.report({ node, message: assertionMessage });
      },
      TSTypeAssertion(node) {
        context.report({ node, message: assertionMessage });
      },
    };
  },
});

const noAny = defineRule({
  create(context) {
    return {
      TSAnyKeyword(node) {
        context.report({
          node,
          message:
            "Don't use `any`. Use `unknown` and narrow it (or decode it with Schema), or write the precise type.",
        });
      },
    };
  },
});

const preferEffectFn = defineRule({
  create(context) {
    return {
      ArrowFunctionExpression(node) {
        // Inline callbacks like it.effect("...", () => Effect.gen(...)) are fine.
        if (node.parent.type === "CallExpression" || node.params.length === 0) return;
        const body = node.body;
        if (body.type !== "CallExpression" || memberPath(body.callee) !== "Effect.gen") return;
        context.report({
          node,
          message:
            'Write functions that return an Effect with Effect.fn: `const name = Effect.fn("Service.name")(function* (arg) { ... })`. It adds a trace span and keeps one style.',
        });
      },
    };
  },
});

const serviceMessage =
  'Declare services one way: `class Name extends Context.Service<Name, { ... }>()("kladd/<package>/Name") {}` (example: packages/core/src/ports/ScreenCapture.ts).';

const serviceStyle = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        const path = memberPath(node);
        if (path === "Context.Tag" || path === "Context.GenericTag" || path === "Effect.Service") {
          context.report({ node, message: serviceMessage });
        }
      },
      CallExpression(node) {
        if (memberPath(node.callee) !== "Context.Service") return;
        // Class form is `Context.Service<...>()("id")`: the inner call has no arguments.
        if (node.arguments.length > 0) {
          context.report({ node, message: serviceMessage });
          return;
        }
        const parent = node.parent;
        if (parent.type !== "CallExpression") return;
        const id = parent.arguments[0];
        if (
          id?.type === "Literal" &&
          typeof id.value === "string" &&
          !id.value.startsWith("kladd/")
        ) {
          context.report({
            node,
            message: `Service id "${id.value}" must start with "kladd/<package>/", for example "kladd/core/ScreenCapture".`,
          });
        }
      },
    };
  },
});

const schemaErrors = defineRule({
  create(context) {
    return {
      MemberExpression(node) {
        const path = memberPath(node);
        if (path !== "Data.TaggedError" && path !== "Data.Error") return;
        context.report({
          node,
          message:
            "Define errors with Schema.TaggedError in packages/domain so they can cross RPC (example: RecordingAlreadyActive in packages/domain/src/RecordingSession.ts).",
        });
      },
    };
  },
});

const WINDOW_TABLE = "apps/desktop/src/main/windows.ts";

const oneWindowTable = defineRule({
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "BrowserWindow") return;
        context.report({
          node,
          message: `Create windows only through the window table in ${WINDOW_TABLE}. Kladd is overlays only: add a WindowKind in packages/domain/src/Window.ts, a row in the table and a route in apps/ui/src/routes, then show it with the OverlayWindows port.`,
        });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "kladd" },
  rules: {
    "no-effect-run": noEffectRun,
    "no-throw": noThrow,
    "no-try-catch": noTryCatch,
    "no-async": noAsync,
    "no-type-assertion": noTypeAssertion,
    "no-any": noAny,
    "prefer-effect-fn": preferEffectFn,
    "service-style": serviceStyle,
    "schema-errors": schemaErrors,
    "one-window-table": oneWindowTable,
  },
});
