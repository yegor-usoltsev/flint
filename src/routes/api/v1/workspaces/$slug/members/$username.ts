import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  removeMember,
  updateMember,
  UpdateMemberSchema,
} from "~/server/members.server";

export const Route = createFileRoute(
  "/api/v1/workspaces/$slug/members/$username"
)({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /workspaces/:slug/members/:username">(
        async ({ actor, params }) => {
          await removeMember(actor, params.slug, params.username);
        }
      ),
      PATCH: endpoint<"PATCH /workspaces/:slug/members/:username">(
        async ({ actor, body, params }) =>
          await updateMember(
            actor,
            params.slug,
            params.username,
            await body(UpdateMemberSchema)
          )
      ),
    },
  },
});
