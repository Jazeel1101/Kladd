import { screenshotScheme } from "@kladd/contract";
import { SessionStore } from "@kladd/core";
import { ScreenshotId, SessionId } from "@kladd/domain";
import { app, net, protocol } from "electron";
import { Effect, Layer, Option, Schema } from "effect";
import { pathToFileURL } from "node:url";

/**
 * Call before the app is ready (ElectronAppLive): lets the UI load
 * `kladd-screenshot://<session id>/<screenshot id>` images (screenshotUrl).
 */
export const registerScreenshotScheme = () =>
  protocol.registerSchemesAsPrivileged([
    { scheme: screenshotScheme, privileges: { standard: true, secure: true } },
  ]);

const notFound = () => new Response(null, { status: 404 });

/**
 * Serves `kladd-screenshot://<session id>/<screenshot id>` from the session's folder. Only an
 * existing session folder and a valid ScreenshotId (a UUID) map to a file, so a URL can't reach
 * outside a session's screenshots.
 */
export const ScreenshotProtocolLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* SessionStore;
    const context = yield* Effect.context<never>();
    yield* Effect.promise(() => app.whenReady());

    const respond = Effect.fn("ScreenshotProtocol.respond")(function* (url: string) {
      const { hostname, pathname } = new URL(url);
      const id = Schema.decodeOption(ScreenshotId)(pathname.slice(1));
      if (Option.isNone(id)) return notFound();
      const folder = yield* store.folder(SessionId.make(hostname));
      if (Option.isNone(folder)) return notFound();
      const file = yield* store.screenshotFile(folder.value, id.value);
      return yield* Effect.tryPromise(() => net.fetch(pathToFileURL(file).toString()));
    }, Effect.orElseSucceed(notFound));

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
