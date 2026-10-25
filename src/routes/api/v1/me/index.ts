import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { getMe } from "~/server/users.server";

export const Route = createFileRoute("/api/v1/me/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /me">(async ({ actor }) => await getMe(actor)),
    },
  },
});
