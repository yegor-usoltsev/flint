import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { readSearchQuery, search } from "~/server/search.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/search")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/search">(
        async ({ actor, params, request }) =>
          await search(actor, params.slug, readSearchQuery(request))
      ),
    },
  },
});
