import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deleteIssue,
  getIssue,
  updateIssue,
  UpdateIssueSchema,
} from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/issues/$issueKey/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /issues/:issueKey">(
        async ({ actor, params }) => await deleteIssue(actor, params.issueKey)
      ),
      GET: endpoint<"GET /issues/:issueKey">(
        async ({ actor, params }) => await getIssue(actor, params.issueKey)
      ),
      PATCH: endpoint<"PATCH /issues/:issueKey">(
        async ({ actor, body, params }) =>
          await updateIssue(
            actor,
            params.issueKey,
            await body(UpdateIssueSchema)
          )
      ),
    },
  },
});
