import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import { listAttachments, uploadAttachment } from "~/server/attachments.server";

export const Route = createFileRoute("/api/v1/issues/$issueKey/attachments")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /issues/:issueKey/attachments">(
        async ({ actor, params }) =>
          await listAttachments(actor, { issueKey: params.issueKey })
      ),
      POST: endpoint<"POST /issues/:issueKey/attachments">(
        async ({ actor, params, request }) =>
          created(
            await uploadAttachment(
              actor,
              { issueKey: params.issueKey },
              request
            )
          )
      ),
    },
  },
});
