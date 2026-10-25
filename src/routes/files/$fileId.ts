import { createFileRoute } from "@tanstack/react-router";

import { apiHandler, methodNotAllowed } from "~/server/api.server";
import { downloadFile } from "~/server/attachments.server";

export const Route = createFileRoute("/files/$fileId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: apiHandler<{ fileId: string }>(
        async ({ actor, params, request }) =>
          await downloadFile(actor, params.fileId, request)
      ),
    },
  },
});
