import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  createProject,
  CreateProjectSchema,
  listProjects,
} from "~/server/projects.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/projects")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/projects">(
        async ({ actor, params }) => await listProjects(actor, params.slug)
      ),
      POST: endpoint<"POST /workspaces/:slug/projects">(
        async ({ actor, body, params }) =>
          created(
            await createProject(
              actor,
              params.slug,
              await body(CreateProjectSchema)
            )
          )
      ),
    },
  },
});
