import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { listTrash } from "~/server/trash.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/trash")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/trash">(
        async ({ actor, params }) => await listTrash(actor, params.slug)
      ),
    },
  },
});
