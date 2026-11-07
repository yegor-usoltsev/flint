import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { bootPreloads } from "~/server/boot-preload.server";
import { newNonce, pagePolicy } from "~/server/security-headers.server";

const withPolicy = <Result extends { response: Response }>(
  result: Result,
  nonce: string,
  request: Request
) => {
  const { headers, status } = result.response;

  if (headers.get("content-type")?.startsWith("text/html") === true) {
    headers.set("Content-Security-Policy", pagePolicy(nonce));

    const preloads = bootPreloads(new URL(request.url).pathname);

    if (status === 200 && preloads !== null) {
      headers.set("Link", preloads);
    }
  }

  return result;
};

const nonceMiddleware = createMiddleware().server(async ({ next, request }) => {
  const nonce = newNonce();

  return await Promise.resolve(next({ context: { nonce } })).then((result) =>
    withPolicy(result, nonce, request)
  );
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [nonceMiddleware, csrfMiddleware],
}));
