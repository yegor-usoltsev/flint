import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { restoreIssue } from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/issues/$issueKey/restore")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: endpoint<"POST /issues/:issueKey/restore">(
        async ({ actor, params }) => await restoreIssue(actor, params.issueKey)
      ),
    },
  },
});
