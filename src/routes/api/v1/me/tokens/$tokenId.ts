import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import { revokeToken } from "~/server/tokens.server";

export const Route = createFileRoute("/api/v1/me/tokens/$tokenId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /me/tokens/:tokenId">(
        async ({ actor, params }) => {
          await revokeToken(actor, params.tokenId);
        }
      ),
    },
  },
});
