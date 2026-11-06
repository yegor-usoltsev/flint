import { randomBytes } from "node:crypto";

import { env } from "~/server/env.server";

const giteaOrigin = new URL(env.GITEA_PUBLIC_URL).origin;

const policy = (scriptSources: string) =>
  `default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: ${giteaOrigin}; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSources}; connect-src 'self'; manifest-src 'self'`;

export const newNonce = () => randomBytes(16).toString("base64");

export const pagePolicy = (nonce: string) => policy(`'self' 'nonce-${nonce}'`);

export const securityHeaders = {
  "Content-Security-Policy": policy("'self'"),
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
