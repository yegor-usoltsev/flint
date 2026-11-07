import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  listPresence,
  PresenceSchema,
  updatePresence,
} from "~/server/presence.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/presence")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/presence">(
        async ({ actor, params }) => await listPresence(actor, params.slug)
      ),
      POST: endpoint<"POST /workspaces/:slug/presence">(
        async ({ actor, body, params }) => {
          await updatePresence(actor, params.slug, await body(PresenceSchema));
        }
      ),
    },
  },
});
