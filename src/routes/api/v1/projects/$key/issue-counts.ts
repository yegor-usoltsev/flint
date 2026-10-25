import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { countProjectIssues, readIssueQuery } from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/projects/$key/issue-counts")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /projects/:key/issue-counts">(
        async ({ actor, params, request }) =>
          await countProjectIssues(actor, params.key, readIssueQuery(request))
      ),
    },
  },
});
