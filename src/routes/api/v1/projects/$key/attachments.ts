import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import { uploadAttachment } from "~/server/attachments.server";

export const Route = createFileRoute("/api/v1/projects/$key/attachments")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      POST: endpoint<"POST /projects/:key/attachments">(
        async ({ actor, params, request }) =>
          created(
            await uploadAttachment(actor, { projectKey: params.key }, request)
          )
      ),
    },
  },
});
