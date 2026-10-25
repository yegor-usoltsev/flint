import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { getRevision } from "~/server/wiki.server";

export const Route = createFileRoute(
  "/api/v1/wiki/$pageId/revisions/$revision/"
)({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /wiki/:pageId/revisions/:revision">(
        async ({ actor, params }) =>
          await getRevision(actor, params.pageId, params.revision)
      ),
    },
  },
});
