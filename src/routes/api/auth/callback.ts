import { createFileRoute } from "@tanstack/react-router";

import { finishLogin } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/callback")({
  server: { handlers: { GET: finishLogin } },
});
