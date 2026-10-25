import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { purgePage } from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/trash/wiki/$pageId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /trash/wiki/:pageId">(
        async ({ actor, params }) => {
          await purgePage(actor, params.pageId);
        }
      ),
    },
  },
});
