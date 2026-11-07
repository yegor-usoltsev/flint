import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  createLabel,
  CreateLabelSchema,
  listLabels,
} from "~/server/labels.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/labels")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/labels">(
        async ({ actor, params, request }) =>
          await listLabels(
            actor,
            params.slug,
            new URL(request.url).searchParams.get("counts") === "true"
          )
      ),
      POST: endpoint<"POST /workspaces/:slug/labels">(
        async ({ actor, body, params }) =>
          created(
            await createLabel(actor, params.slug, await body(CreateLabelSchema))
          )
      ),
    },
  },
});
