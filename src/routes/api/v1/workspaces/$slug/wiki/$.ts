import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deletePage,
  getPage,
  patchPage,
  PatchPageSchema,
  putPage,
  PutPageSchema,
} from "~/server/wiki.server";

export const Route = createFileRoute("/api/v1/workspaces/$slug/wiki/$")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /workspaces/:slug/wiki/*">(
        async ({ actor, params }) => {
          await deletePage(actor, params.slug, params._splat);
        }
      ),
      GET: endpoint<"GET /workspaces/:slug/wiki/*">(
        async ({ actor, params }) =>
          await getPage(actor, params.slug, params._splat)
      ),
      PATCH: endpoint<"PATCH /workspaces/:slug/wiki/*">(
        async ({ actor, body, params }) =>
          await patchPage(
            actor,
            { path: params._splat, slug: params.slug },
            await body(PatchPageSchema)
          )
      ),
      PUT: endpoint<"PUT /workspaces/:slug/wiki/*">(
        async ({ actor, body, params }) =>
          await putPage(
            actor,
            { path: params._splat, slug: params.slug },
            await body(PutPageSchema)
          )
      ),
    },
  },
});
