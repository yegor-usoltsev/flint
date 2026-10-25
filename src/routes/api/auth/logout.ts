import { createFileRoute } from "@tanstack/react-router";

import { logout } from "~/server/oauth.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: { handlers: { POST: logout } },
});
