import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import { listAttachments, uploadAttachment } from "~/server/attachments.server";

export const Route = createFileRoute("/api/v1/wiki/$pageId/attachments")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /wiki/:pageId/attachments">(
        async ({ actor, params }) =>
          await listAttachments(actor, { pageId: params.pageId })
      ),
      POST: endpoint<"POST /wiki/:pageId/attachments">(
        async ({ actor, params, request }) =>
          created(
            await uploadAttachment(actor, { pageId: params.pageId }, request)
          )
      ),
    },
  },
});
