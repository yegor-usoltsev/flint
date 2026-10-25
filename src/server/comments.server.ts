// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Comment } from "~/lib/api-types";
import {
  isUuid,
  notFound,
  userRef,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { findIssue, recordEvents } from "~/server/issues.server";
import { publish } from "~/server/realtime.server";

const BodySchema = v.pipe(
  v.string(),
  v.check((body) => body.trim() !== "", "Comment is empty"),
  v.maxLength(100_000)
);

export const CreateCommentSchema = v.object({
  body: BodySchema,
  id: v.optional(v.pipe(v.string(), v.uuid())),
});

export const UpdateCommentSchema = v.object({
  body: BodySchema,
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

const commentColumns = db`
  c.id, c.issue_id as "issueId", c.body_md as body,
  c.created_at as "createdAt", c.edited_at as "editedAt", c.version,
  c.via_token_id is not null as "viaApi", ${userRef} as author
`;

const selectComment = async (id: string) => {
  const [comment] = await db<Comment[]>`
    select ${commentColumns}
    from comments c
    join users u on u.id = c.author_id
    where c.id = ${id}
  `;

  if (comment === undefined) {
    throw notFound("Comment");
  }

  return comment;
};

export const listComments = async (actor: Actor, key: string) => {
  const issue = await findIssue(actor, key);

  return await db<Comment[]>`
    select ${commentColumns}
    from comments c
    join users u on u.id = c.author_id
    where c.issue_id = ${issue.id} and c.deleted_at is null
    order by c.created_at, c.id
  `;
};

export const createComment = async (
  actor: Actor,
  key: string,
  { body, id = Bun.randomUUIDv7() }: v.InferOutput<typeof CreateCommentSchema>
) => {
  const issue = await findIssue(actor, key);

  await db.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      insert into comments (id, issue_id, author_id, via_token_id, body_md)
      values (
        ${id}, ${issue.id}, ${actor.userId}, ${actor.tokenId ?? null}, ${body}
      )
      on conflict (id) do nothing
      returning id
    `;

    if (inserted.length === 0) {
      throw new ApiError(409, "conflict", "A comment with this id exists");
    }

    await recordEvents(tx, actor, issue.id, [
      { kind: "comment_created", to: id },
    ]);
  });

  publish(issue.workspaceId, {
    entity: "comment",
    id,
    issueId: issue.id,
    projectId: issue.projectId,
  });

  return await selectComment(id);
};

const findOwnComment = async (actor: Actor, id: string) => {
  const [comment] = isUuid(id)
    ? await db<
        {
          authorId: string;
          issueId: string;
          projectId: string;
          workspaceId: string;
        }[]
      >`
        select c.author_id as "authorId", c.issue_id as "issueId",
          i.project_id as "projectId", p.workspace_id as "workspaceId"
        from comments c
        join issues i on i.id = c.issue_id
        join projects p on p.id = i.project_id
        where c.id = ${id} and c.deleted_at is null
      `
    : [];

  if (
    comment === undefined ||
    (await workspaceRole(actor, comment.workspaceId)) === null
  ) {
    throw notFound("Comment");
  }

  if (comment.authorId !== actor.userId) {
    throw new ApiError(
      403,
      "forbidden",
      "Only the author can change a comment"
    );
  }

  return comment;
};

const changeComment = async (
  actor: Actor,
  id: string,
  body: string | null,
  version?: number
) => {
  const comment = await findOwnComment(actor, id);

  await db.begin(async (tx) => {
    const changed = await (body === null
      ? tx<{ id: string }[]>`
          update comments set deleted_at = now() where id = ${id} returning id
        `
      : tx<{ id: string }[]>`
          update comments
          set body_md = ${body}, edited_at = now(), version = version + 1
          where id = ${id} and deleted_at is null
            and (${version ?? null}::int is null or version = ${version ?? null})
          returning id
        `);

    if (changed.length === 0) {
      throw new ApiError(
        409,
        "conflict",
        "The comment changed since you started editing it",
        await selectComment(id)
      );
    }

    await recordEvents(tx, actor, comment.issueId, [
      { kind: body === null ? "comment_deleted" : "comment_edited", to: id },
    ]);
  });

  publish(comment.workspaceId, {
    entity: "comment",
    id,
    issueId: comment.issueId,
    projectId: comment.projectId,
  });
};

export const updateComment = async (
  actor: Actor,
  id: string,
  { body, version }: v.InferOutput<typeof UpdateCommentSchema>
) => {
  await changeComment(actor, id, body, version);

  return await selectComment(id);
};

export const deleteComment = async (actor: Actor, id: string) => {
  await changeComment(actor, id, null);
};
