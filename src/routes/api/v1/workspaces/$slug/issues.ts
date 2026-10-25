import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { listWorkspaceIssues, readIssueQuery } from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/issues")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/issues">(
        async ({ actor, params, request }) =>
          await listWorkspaceIssues(actor, params.slug, readIssueQuery(request))
      ),
    },
  },
});
