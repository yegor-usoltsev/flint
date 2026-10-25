import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { deletePageById, getPageById } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/wiki/$pageId/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /wiki/:pageId">(async ({ actor, params }) => {
        await deletePageById(actor, params.pageId);
      }),
      GET: endpoint<"GET /wiki/:pageId">(
        async ({ actor, params }) => await getPageById(actor, params.pageId)
      ),
    },
  },
});
