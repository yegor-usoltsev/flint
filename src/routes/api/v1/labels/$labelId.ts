import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deleteLabel,
  updateLabel,
  UpdateLabelSchema,
} from "~/server/labels.server";

export const Route = createFileRoute("/api/v1/labels/$labelId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /labels/:labelId">(async ({ actor, params }) => {
        await deleteLabel(actor, params.labelId);
      }),
      PATCH: endpoint<"PATCH /labels/:labelId">(
        async ({ actor, body, params }) =>
          await updateLabel(
            actor,
            params.labelId,
            await body(UpdateLabelSchema)
          )
      ),
    },
  },
});
