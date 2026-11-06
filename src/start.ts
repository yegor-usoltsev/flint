import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { newNonce, pagePolicy } from "~/server/security-headers.server";

const withPolicy = <Result extends { response: Response }>(
  result: Result,
  nonce: string
) => {
  if (
    result.response.headers.get("content-type")?.startsWith("text/html") ===
    true
  ) {
    result.response.headers.set("Content-Security-Policy", pagePolicy(nonce));
  }

  return result;
};

const nonceMiddleware = createMiddleware().server(async ({ next }) => {
  const nonce = newNonce();

  return await Promise.resolve(next({ context: { nonce } })).then((result) =>
    withPolicy(result, nonce)
  );
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [nonceMiddleware, csrfMiddleware],
}));
