import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { getR2IndexMissKey } from "./lib/cf";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  const cfContext = _loadContext.cloudflare;
  const url = new URL(request.url);
  const r2Missed = await cfContext.env.R2_INDEX_CACHE.get(
    getR2IndexMissKey(url.host, url.pathname)
  );

  if (!request.url.endsWith("/") && r2Missed === null) {
    const r2Response = await fetch(new Request(request));
    if (r2Response.status !== 404) {
      return r2Response;
    } else {
      cfContext.ctx.waitUntil(
        cfContext.env.R2_INDEX_CACHE.put(
          getR2IndexMissKey(url.host, url.pathname),
          url.toString(),
          {
            expirationTtl: 60,
          }
        )
      );
    }
  }

  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
