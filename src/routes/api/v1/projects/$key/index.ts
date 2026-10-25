import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deleteProject,
  getProject,
  updateProject,
  UpdateProjectSchema,
} from "~/server/projects.server";

export const Route = createFileRoute("/api/v1/projects/$key/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /projects/:key">(async ({ actor, params }) => {
        await deleteProject(actor, params.key);
      }),
      GET: endpoint<"GET /projects/:key">(
        async ({ actor, params }) => await getProject(actor, params.key)
      ),
      PATCH: endpoint<"PATCH /projects/:key">(
        async ({ actor, body, params }) =>
          await updateProject(
            actor,
            params.key,
            await body(UpdateProjectSchema)
          )
      ),
    },
  },
});
