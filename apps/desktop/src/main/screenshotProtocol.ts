import { screenshotScheme } from "@kladd/contract";
import { ScreenshotFiles } from "@kladd/core";
import { ScreenshotId } from "@kladd/domain";
import { app, net, protocol } from "electron";
import { Effect, Layer, Option, Schema } from "effect";
import { pathToFileURL } from "node:url";

/** Call before the app is ready (ElectronAppLive): lets the UI load `kladd-screenshot://<id>` images. */
export const registerScreenshotScheme = () =>
  protocol.registerSchemesAsPrivileged([
    { scheme: screenshotScheme, privileges: { standard: true, secure: true } },
  ]);

const notFound = () => new Response(null, { status: 404 });

/**
 * Serves `kladd-screenshot://<id>` from ScreenshotFiles. Only a valid ScreenshotId (a UUID) maps
 * to a file, so a URL can't reach outside the screenshots directory.
 */
export const ScreenshotProtocolLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const files = yield* ScreenshotFiles;
    const context = yield* Effect.context<never>();
    yield* Effect.promise(() => app.whenReady());

    const respond = Effect.fn("ScreenshotProtocol.respond")(function* (url: string) {
      const id = Schema.decodeOption(ScreenshotId)(new URL(url).hostname);
      if (Option.isNone(id)) return notFound();
      const file = yield* files.file(id.value);
      return yield* Effect.tryPromise(() => net.fetch(pathToFileURL(file).toString())).pipe(
        Effect.orElseSucceed(notFound),
      );
    });

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        protocol.handle(screenshotScheme, (request) =>
          Effect.runPromiseWith(context)(respond(request.url)),
        ),
      ),
      () => Effect.sync(() => protocol.unhandle(screenshotScheme)),
    );
  }),
);
