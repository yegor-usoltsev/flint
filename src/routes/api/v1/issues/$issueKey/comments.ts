import { createFileRoute } from "@tanstack/react-router";

import { created, endpoint, methodNotAllowed } from "~/server/api.server";
import {
  createComment,
  CreateCommentSchema,
  listComments,
} from "~/server/comments.server";

export const Route = createFileRoute("/api/v1/issues/$issueKey/comments")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      GET: endpoint<"GET /issues/:issueKey/comments">(
        async ({ actor, params }) => await listComments(actor, params.issueKey)
      ),
      POST: endpoint<"POST /issues/:issueKey/comments">(
        async ({ actor, body, params }) =>
          created(
            await createComment(
              actor,
              params.issueKey,
              await body(CreateCommentSchema)
            )
          )
      ),
    },
  },
});
