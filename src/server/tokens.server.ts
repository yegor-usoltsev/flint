// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { ApiToken, CreatedApiToken } from "~/lib/api-types";
import { isUuid, notFound, requireWorkspace } from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { hashToken, newSecret } from "~/server/sessions.server";

const SlugSchema = v.pipe(v.string(), v.trim(), v.nonEmpty());

export const CreateTokenSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(100)),
  workspace: v.optional(SlugSchema),
  workspaces: v.optional(
    v.pipe(v.array(SlugSchema), v.minLength(1), v.maxLength(100))
  ),
});

const tokenColumns = db`
  t.id, t.name, t.prefix, t.created_at as "createdAt",
  t.last_used_at as "lastUsedAt",
  case when t.restricted then coalesce((
    select json_agg(
      json_build_object('id', w.id, 'slug', w.slug, 'name', w.name)
      order by lower(w.name), w.slug
    )
    from api_token_workspaces a join workspaces w on w.id = a.workspace_id
    where a.token_id = t.id
  ), '[]') end as workspaces
`;

// oxlint-disable-next-line typescript/promise-function-async -- Returns an unexecuted Bun SQL fragment, which is thenable.
const withinActor = (actor: Actor) => db`
  (
    ${actor.workspaceIds === undefined}
    or (
      t.restricted and not exists (
        select 1 from api_token_workspaces a
        where a.token_id = t.id
          and a.workspace_id <> all(${db.array(actor.workspaceIds ?? [], "uuid")})
      )
    )
  )
`;

const selectToken = async (id: string) => {
  const [token] = await db<ApiToken[]>`
    select ${tokenColumns} from api_tokens t where t.id = ${id}
  `;

  if (token === undefined) {
    throw notFound("Token");
  }

  return token;
};

export const createToken = async (
  actor: Actor,
  { name, workspace, workspaces }: v.InferOutput<typeof CreateTokenSchema>
): Promise<CreatedApiToken> => {
  const slugs = workspaces ?? (workspace === undefined ? null : [workspace]);

  if (actor.workspaceIds !== undefined && slugs === null) {
    throw new ApiError(
      403,
      "forbidden",
      "A token restricted to workspaces can only create tokens within them"
    );
  }

  const scope =
    slugs === null
      ? null
      : await Promise.all(
          [...new Set(slugs)].map(
            async (slug) => await requireWorkspace(actor, slug)
          )
        );

  const token = `flint_${newSecret()}`;
  const id = Bun.randomUUIDv7();

  await db.begin(async (tx) => {
    await tx`
      insert into api_tokens (id, user_id, restricted, name, token_hash, prefix)
      values (
        ${id}, ${actor.userId}, ${scope !== null}, ${name}, ${hashToken(token)},
        ${token.slice(0, 14)}
      )
    `;

    if (scope !== null) {
      await tx`
        insert into api_token_workspaces ${tx(
          scope.map((item) => ({ token_id: id, workspace_id: item.id }))
        )}
      `;
    }
  });

  return { ...(await selectToken(id)), token };
};

export const listTokens = async (actor: Actor) =>
  await db<ApiToken[]>`
    select ${tokenColumns}
    from api_tokens t
    where t.user_id = ${actor.userId} and t.revoked_at is null
      and ${withinActor(actor)}
    order by t.created_at desc
  `;

export const revokeToken = async (actor: Actor, id: string) => {
  const rows = isUuid(id)
    ? await db<{ id: string }[]>`
        update api_tokens t set revoked_at = now()
        where t.id = ${id} and t.user_id = ${actor.userId}
          and t.revoked_at is null and ${withinActor(actor)}
        returning t.id
      `
    : [];

  if (rows.length === 0) {
    throw notFound("Token");
  }
};
