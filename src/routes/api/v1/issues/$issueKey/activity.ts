import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { listIssueEvents } from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/issues/$issueKey/activity")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /issues/:issueKey/activity">(
        async ({ actor, params }) =>
          await listIssueEvents(actor, params.issueKey)
      ),
    },
  },
});
