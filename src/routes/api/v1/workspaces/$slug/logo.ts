import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { removeLogo, setLogo } from "~/server/workspaces.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/logo")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /workspaces/:slug/logo">(
        async ({ actor, params }) => await removeLogo(actor, params.slug)
      ),
      PUT: endpoint<"PUT /workspaces/:slug/logo">(
        async ({ actor, params, request }) =>
          await setLogo(actor, params.slug, request)
      ),
    },
  },
});
