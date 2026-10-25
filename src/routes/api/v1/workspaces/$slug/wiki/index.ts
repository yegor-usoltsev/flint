import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { listPages } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/wiki/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/wiki">(
        async ({ actor, params, request }) =>
          await listPages(
            actor,
            params.slug,
            new URL(request.url).searchParams.get("prefix") ?? ""
          )
      ),
    },
  },
});
