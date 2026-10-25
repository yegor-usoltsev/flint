import { createFileRoute } from "@tanstack/react-router";

import { requireWorkspace } from "~/server/access.server";
import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deleteWorkspace,
  updateWorkspace,
  UpdateWorkspaceSchema,
} from "~/server/workspaces.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /workspaces/:slug">(
        async ({ actor, params }) => {
          await deleteWorkspace(actor, params.slug);
        }
      ),
      GET: endpoint<"GET /workspaces/:slug">(
        async ({ actor, params }) => await requireWorkspace(actor, params.slug)
      ),
      PATCH: endpoint<"PATCH /workspaces/:slug">(
        async ({ actor, body, params }) =>
          await updateWorkspace(
            actor,
            params.slug,
            await body(UpdateWorkspaceSchema)
          )
      ),
    },
  },
});
