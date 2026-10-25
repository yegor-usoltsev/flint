import { createFileRoute } from "@tanstack/react-router";

import { build } from "~/lib/build";
import { checkHealth } from "~/server/health.server";

const noCache = { "Cache-Control": "no-store" };

const respondWithHealth = async () => {
  const health = await checkHealth();
  const up = Object.values(health).every((status) => status === "ok");

  return Response.json(
    { status: up ? "up" : "down", ...build, ...health },
    { headers: noCache, status: up ? 200 : 503 }
  );
};

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: respondWithHealth } },
});
