import { createFileRoute } from "@tanstack/react-router";

import { endpoint, methodNotAllowed } from "~/server/api.server";
import {
  deleteComment,
  updateComment,
  UpdateCommentSchema,
} from "~/server/comments.server";

export const Route = createFileRoute("/api/v1/comments/$commentId")({
  server: {
    handlers: {
      ANY: methodNotAllowed,
      DELETE: endpoint<"DELETE /comments/:commentId">(
        async ({ actor, params }) => {
          await deleteComment(actor, params.commentId);
        }
      ),
      PATCH: endpoint<"PATCH /comments/:commentId">(
        async ({ actor, body, params }) =>
          await updateComment(
            actor,
            params.commentId,
            await body(UpdateCommentSchema)
          )
      ),
    },
  },
});
