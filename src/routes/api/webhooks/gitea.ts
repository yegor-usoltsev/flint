import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed } from "~/server/api.server";
import { receiveGiteaWebhook } from "~/server/gitea-webhook.server";

export const Route = createFileRoute("/api/webhooks/gitea")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: receiveGiteaWebhook,
    },
  },
});
