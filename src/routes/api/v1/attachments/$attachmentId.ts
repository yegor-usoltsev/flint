import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { deleteAttachment } from "~/server/attachments.server";

export const Route = createFileRoute("/api/v1/attachments/$attachmentId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /attachments/:attachmentId">(
        async ({ actor, params }) => {
          await deleteAttachment(actor, params.attachmentId);
        }
      ),
    },
  },
});
