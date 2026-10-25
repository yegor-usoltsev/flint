import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { purgeIssue } from "~/server/trash.server";

export const Route = createFileRoute("/api/v1/trash/issues/$issueKey")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /trash/issues/:issueKey">(
        async ({ actor, params }) => {
          await purgeIssue(actor, params.issueKey);
        }
      ),
    },
  },
});
