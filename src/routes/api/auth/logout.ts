import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed } from "~/server/api.server";
import { logout } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: { handlers: { ANY: methodNotAllowed, POST: logout } },
});
