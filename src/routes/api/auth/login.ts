import { createFileRoute } from "@tanstack/react-router";

import { startLogin } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/login")({
  server: { handlers: { GET: startLogin } },
});
