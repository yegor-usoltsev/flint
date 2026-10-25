import { createFileRoute } from "@tanstack/react-router";

import { errorResponse } from "~/server/api.server";

const unknownEndpoint = () =>
  errorResponse(404, "not_found", "No such API endpoint");

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      ANY: unknownEndpoint,
    },
  },
});
