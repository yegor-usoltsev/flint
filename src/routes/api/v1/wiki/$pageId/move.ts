import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { movePage, MovePageSchema } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/wiki/$pageId/move")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: endpoint<"POST /wiki/:pageId/move">(
        async ({ actor, body, params }) =>
          await movePage(actor, params.pageId, await body(MovePageSchema))
      ),
    },
  },
});
