import { createFileRoute } from "@tanstack/react-router";

import { methodNotAllowed } from "~/server/api.server";
import { finishLogin } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/callback")({
  server: { handlers: { ANY: methodNotAllowed, GET: finishLogin } },
});
