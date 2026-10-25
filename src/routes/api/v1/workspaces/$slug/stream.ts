import { createFileRoute } from "@tanstack/react-router";

import { apiHandler, methodNotAllowed } from "~/server/api.server";
import { streamWorkspace } from "~/server/realtime.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/stream")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: apiHandler<{ slug: string }>(
        async ({ actor, params, request }) =>
          await streamWorkspace(actor, params.slug, request)
      ),
    },
  },
});
