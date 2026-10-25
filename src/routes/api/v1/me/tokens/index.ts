import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  createToken,
  CreateTokenSchema,
  listTokens,
} from "~/server/tokens.server";

export const Route = createFileRoute("/api/v1/me/tokens/")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /me/tokens">(
        async ({ actor }) => await listTokens(actor)
      ),
      POST: endpoint<"POST /me/tokens">(async ({ actor, body }) =>
        created(await createToken(actor, await body(CreateTokenSchema)))
      ),
    },
  },
});
