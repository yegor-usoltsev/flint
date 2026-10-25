import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { restorePage } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/wiki/$pageId/restore")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: endpoint<"POST /wiki/:pageId/restore">(
        async ({ actor, params }) => await restorePage(actor, params.pageId)
      ),
    },
  },
});
