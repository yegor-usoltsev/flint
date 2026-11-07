import { createFileRoute } from "@tanstack/react-router";

import {
  created,
  endpoint,
  methodNotAllowed,
  withTotal,
} from "~/server/api.server";
import {
  createIssue,
  CreateIssueSchema,
  listProjectIssues,
  readIssueQuery,
} from "~/server/issues.server";

export const Route = createFileRoute("/api/v1/projects/$key/issues")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /projects/:key/issues">(
        async ({ actor, params, request }) => {
          const { issues, total } = await listProjectIssues(
            actor,
            params.key,
            readIssueQuery(request)
          );

          return withTotal(issues, total);
        }
      ),
      POST: endpoint<"POST /projects/:key/issues">(
        async ({ actor, body, params }) =>
          created(
            await createIssue(actor, params.key, await body(CreateIssueSchema))
          )
      ),
    },
  },
});
