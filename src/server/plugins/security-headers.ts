import { definePlugin } from "nitro";

import { securityHeaders } from "~/server/security-headers.server";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (response) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      if (!response.headers.has(name)) {
        response.headers.set(name, value);
      }
    }
  });
});
