import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { listRevisions } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/wiki/$pageId/revisions/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /wiki/:pageId/revisions">(
        async ({ actor, params }) => await listRevisions(actor, params.pageId)
      ),
    },
  },
});
