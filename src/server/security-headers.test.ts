import { expect, test } from "bun:test";

import {
  newNonce,
  pagePolicy,
  securityHeaders,
} from "~/server/security-headers.server";

const scriptSources = (policy: string) =>
  /(?:^|; )script-src (?<sources>[^;]+)/u.exec(policy)?.groups?.["sources"];

test("scripts run only from Flint's origin, and inline ones only with the page's nonce", () => {
  const nonce = newNonce();

  expect(nonce).not.toBe(newNonce());
  expect(scriptSources(securityHeaders["Content-Security-Policy"])).toBe(
    "'self'"
  );
  expect(scriptSources(pagePolicy(nonce))).toBe(`'self' 'nonce-${nonce}'`);
});
