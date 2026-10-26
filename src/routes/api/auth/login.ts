import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed } from "~/server/api.server";
import { startLogin } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/login")({
  server: { handlers: { ANY: methodNotAllowed, GET: startLogin } },
});
