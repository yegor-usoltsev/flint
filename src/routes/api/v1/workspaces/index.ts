import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  createWorkspace,
  CreateWorkspaceSchema,
  listWorkspaces,
} from "~/server/workspaces.server";

export const Route = createFileRoute("/api/v1/workspaces/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces">(
        async ({ actor }) => await listWorkspaces(actor)
      ),
      POST: endpoint<"POST /workspaces">(async ({ actor, body }) =>
        created(await createWorkspace(actor, await body(CreateWorkspaceSchema)))
      ),
    },
  },
});
