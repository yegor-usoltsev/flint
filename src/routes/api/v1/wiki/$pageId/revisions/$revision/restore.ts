import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { restoreRevision } from "~/server/wiki.server";

export const Route = createFileRoute(
  "/api/v1/wiki/$pageId/revisions/$revision/restore"
)({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: endpoint<"POST /wiki/:pageId/revisions/:revision/restore">(
        async ({ actor, params }) =>
          await restoreRevision(actor, params.pageId, params.revision)
      ),
    },
  },
});
