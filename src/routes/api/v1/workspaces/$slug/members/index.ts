import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  addMember,
  AddMemberSchema,
  listMembers,
} from "~/server/members.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/members/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /workspaces/:slug/members">(
        async ({ actor, params }) => await listMembers(actor, params.slug)
      ),
      POST: endpoint<"POST /workspaces/:slug/members">(
        async ({ actor, body, params }) =>
          created(
            await addMember(actor, params.slug, await body(AddMemberSchema))
          )
      ),
    },
  },
});
