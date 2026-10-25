import type { Trash } from "~/lib/api-types";
import { requireRole, requireWorkspace, userRef } from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { findIssue } from "~/server/issues.server";
import { log } from "~/server/log.server";
import { publish } from "~/server/realtime.server";
import { deleteObjects } from "~/server/s3.server";

const deletedBy = db`
  case when u.id is null then null else ${userRef} end as "deletedBy"
`;

export const listTrash = async (actor: Actor, slug: string): Promise<Trash> => {
  const workspace = await requireWorkspace(actor, slug);

  const [issues, pages] = await Promise.all([
    db<Trash["issues"]>`
      select i.id, p.key || '-' || i.number as key, i.title,
        i.project_id as "projectId", i.deleted_at as "deletedAt",
        i.deleted_at + make_interval(days => ${env.TRASH_RETENTION_DAYS}) as "purgeAt",
        ${deletedBy}
      from issues i
      join projects p on p.id = i.project_id
      left join users u on u.id = i.deleted_by
      where p.workspace_id = ${workspace.id} and i.deleted_at is not null
      order by i.deleted_at desc, i.id
    `,
    db<Trash["pages"]>`
      select w.id, w.kind, w.path, w.title, w.deleted_at as "deletedAt",
        w.deleted_at + make_interval(days => ${env.TRASH_RETENTION_DAYS}) as "purgeAt",
        (select count(*)::int from wiki_pages d where d.deleted_with = w.id)
          as "descendants",
        ${deletedBy}
      from wiki_pages w
      left join users u on u.id = w.deleted_by
      where w.workspace_id = ${workspace.id}
        and w.deleted_at is not null and w.deleted_with is null
      order by w.deleted_at desc, w.id
    `,
  ]);

  return { issues, pages };
};

interface Purged {
  items: { id: string; projectId: string | null; workspaceId: string }[];
  storageKeys: string[];
}

const announce = (entity: "issue" | "wiki", items: Purged["items"]) => {
  for (const { id, projectId, workspaceId } of items) {
    publish(workspaceId, { entity, id, projectId });
  }
};

const deleteIssues = async (ids: string[] | null, before: Date | null) => {
  const [row] = await db<Purged[]>`
    with purged as (
      delete from issues i
      where i.deleted_at is not null
        and (${ids === null}::boolean or i.id = any(${db.array(ids ?? [], "uuid")}))
        and (${before}::timestamptz is null or i.deleted_at < ${before}::timestamptz)
      returning i.id, i.project_id
    )
    select coalesce(json_agg(json_build_object(
        'id', purged.id, 'projectId', purged.project_id,
        'workspaceId', p.workspace_id
      )) filter (where purged.id is not null), '[]') as items,
      array(
        select a.storage_key from attachments a
        where a.issue_id in (select id from purged)
      ) as "storageKeys"
    from purged left join projects p on p.id = purged.project_id
  `;

  await deleteObjects(row?.storageKeys ?? []);
  announce("issue", row?.items ?? []);

  return row?.items.length ?? 0;
};

export const purgeIssue = async (actor: Actor, key: string) => {
  const issue = await findIssue(actor, key);

  requireRole(issue.role, "admin");

  if ((await deleteIssues([issue.id], null)) === 0) {
    throw new ApiError(
      409,
      "not_deleted",
      `${key.toUpperCase()} is not in the trash`
    );
  }
};

export const purgeTrash = async (
  before = new Date(Date.now() - env.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
) => {
  const issues = await deleteIssues(null, before);

  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- Purges run one after another to keep the cleanup's load low.
  const [pages] = await db<Purged[]>`
    with purged as (
      delete from wiki_pages
      where deleted_at < ${before} and deleted_with is null
      returning id, workspace_id
    )
    select coalesce(json_agg(json_build_object(
        'id', purged.id, 'projectId', null, 'workspaceId', purged.workspace_id
      )), '[]') as items,
      array(
        select a.storage_key from attachments a
        join wiki_pages w on w.id = a.wiki_page_id
        where w.id in (select id from purged)
          or w.deleted_with in (select id from purged)
      ) as "storageKeys"
    from purged
  `;

  await deleteObjects(pages?.storageKeys ?? []);
  announce("wiki", pages?.items ?? []);

  const result = { issues, pages: pages?.items.length ?? 0 };

  log.info(result, "Trash purged");

  return result;
};
