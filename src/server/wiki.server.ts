import type { SQL, TransactionSQL } from "bun";
import { generateKeyBetween } from "fractional-indexing";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type {
  WikiNodeKind,
  WikiPage,
  WikiPageSummary,
  WikiRevision,
  WikiRevisionSummary,
} from "~/lib/api-types";
import {
  isUuid,
  notFound,
  requireRole,
  requireWorkspace,
  userRef,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { refreshEmbedding } from "~/server/embeddings.server";
import { SortKeySchema } from "~/server/issues.server";
import { publish } from "~/server/realtime.server";
import { deleteObjects } from "~/server/s3.server";

const maxBody = 500_000;
const maxPath = 200;

const PathSchema = v.pipe(
  v.string(),
  v.toLowerCase(),
  v.maxLength(maxPath),
  v.regex(
    /^[a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)*$/u,
    "Path must be segments of letters, digits, '.', '_' or '-' separated by '/'"
  )
);

const TitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.maxLength(200)
);

const BaseRevisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const IdSchema = v.pipe(v.string(), v.uuid());

export const PutPageSchema = v.object({
  baseRevision: v.optional(BaseRevisionSchema),
  body: v.optional(v.pipe(v.string(), v.maxLength(maxBody))),
  id: v.optional(IdSchema),
  kind: v.optional(v.picklist(["folder", "page"])),
  sortKey: v.optional(SortKeySchema),
  title: v.optional(TitleSchema),
});

export const PatchPageSchema = v.object({
  append: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(maxBody))),
  baseRevision: v.optional(BaseRevisionSchema),
  id: v.optional(IdSchema),
  title: v.optional(TitleSchema),
});

export const MovePageSchema = v.object({
  path: PathSchema,
  sortKey: v.optional(SortKeySchema),
});

const RevisionSchema = v.pipe(
  v.string(),
  v.digits("Revision must be a number"),
  v.transform(Number)
);

const summaryColumns = db`
  w.id, w.kind, w.path, w.revision, w.sort_key as "sortKey", w.title,
  w.updated_at as "updatedAt"
`;

const selectPage = async (sql: SQL, id: string) => {
  const [page] = await sql<WikiPage[]>`
    select ${summaryColumns}, w.body_md as body, w.created_at as "createdAt",
      ${userRef} as "updatedBy", s.slug as "workspaceSlug"
    from wiki_pages w
    join users u on u.id = w.updated_by
    join workspaces s on s.id = w.workspace_id
    where w.id = ${id}
  `;

  if (page === undefined) {
    throw notFound("Wiki page");
  }

  return page;
};

const titleFromPath = (path: string) => {
  const name = (path.split("/").at(-1) ?? path).replaceAll(/[_.-]+/gu, " ");

  return name.charAt(0).toUpperCase() + name.slice(1);
};

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

const lockTree = async (tx: TransactionSQL, workspaceId: string) => {
  await tx`
    select pg_advisory_xact_lock(hashtext('flint_wiki'), hashtext(${workspaceId}))
  `;
};

const lastSortKey = async (
  tx: TransactionSQL,
  workspaceId: string,
  parent: string
) => {
  const [row] = await tx<{ last: string | null }[]>`
    select max(w.sort_key) as last from wiki_pages w
    where w.workspace_id = ${workspaceId} and w.deleted_at is null
      and regexp_replace(w.path, '/?[^/]+$', '') = ${parent}
  `;

  return generateKeyBetween(row?.last ?? null, null);
};

interface Content {
  body: string;
  title: string;
}

interface NewNode {
  id: string;
  kind: WikiNodeKind;
  path: string;
  sortKey: string | null;
  workspaceId: string;
}

const insertNode = async (
  tx: TransactionSQL,
  actor: Actor,
  node: NewNode,
  next: Content
) => {
  const sortKey =
    node.sortKey ??
    (await lastSortKey(tx, node.workspaceId, parentOf(node.path)));

  const inserted = await tx<{ id: string }[]>`
    insert into wiki_pages (
      id, workspace_id, kind, path, sort_key, title, body_md, updated_by
    ) values (
      ${node.id}, ${node.workspaceId}, ${node.kind}, ${node.path}, ${sortKey},
      ${next.title}, ${next.body}, ${actor.userId}
    )
    on conflict do nothing
    returning id
  `;

  if (inserted.length === 0) {
    return false;
  }

  await tx`
    insert into wiki_revisions (
      page_id, revision, title, body_md, author_id, via_token_id
    ) values (
      ${node.id}, 1, ${next.title}, ${next.body}, ${actor.userId},
      ${actor.tokenId ?? null}
    )
  `;

  return true;
};

const ensureParents = async (
  tx: TransactionSQL,
  actor: Actor,
  workspaceId: string,
  path: string
) => {
  const segments = path.split("/").slice(0, -1);

  for (const [index] of segments.entries()) {
    const parent = segments.slice(0, index + 1).join("/");

    // oxlint-disable-next-line no-await-in-loop -- Each folder goes after its parent.
    await insertNode(
      tx,
      actor,
      {
        id: Bun.randomUUIDv7(),
        kind: "folder",
        path: parent,
        sortKey: null,
        workspaceId,
      },
      { body: "", title: titleFromPath(parent) }
    );
  }
};

interface PageRow extends Content {
  id: string;
  kind: WikiNodeKind;
  revision: number;
}

const saveRevision = async (
  tx: TransactionSQL,
  actor: Actor,
  page: PageRow,
  { merge, next }: { merge: boolean; next: Content }
) => {
  const revision = page.revision + 1;

  await tx`
    update wiki_pages set
      title = ${next.title}, body_md = ${next.body}, revision = ${revision},
      updated_by = ${actor.userId}, updated_at = now()
    where id = ${page.id}
  `;

  const merged = merge
    ? await tx<{ revision: number }[]>`
        update wiki_revisions set
          revision = ${revision}, title = ${next.title}, body_md = ${next.body},
          updated_at = now()
        where page_id = ${page.id} and revision = ${page.revision}
          and author_id = ${actor.userId}
          and via_token_id is not distinct from ${actor.tokenId ?? null}::uuid
          and created_at > now() - interval '30 minutes'
          and updated_at > now() - interval '10 minutes'
        returning revision
      `
    : [];

  if (merged.length === 0) {
    await tx`
      insert into wiki_revisions (
        page_id, revision, title, body_md, author_id, via_token_id
      ) values (
        ${page.id}, ${revision}, ${next.title}, ${next.body}, ${actor.userId},
        ${actor.tokenId ?? null}
      )
    `;
  }
};

const pageChanged = (workspaceId: string, id: string) => {
  publish(workspaceId, { entity: "wiki", id, projectId: null });
};

type WriteOptions = Pick<
  v.InferOutput<typeof PutPageSchema>,
  "baseRevision" | "id" | "kind" | "sortKey" | "title"
>;

interface Target {
  path: string;
  slug: string;
}

const writePage = async (
  actor: Actor,
  target: Target,
  options: WriteOptions,
  bodyOf: (body: string | undefined) => string
) => {
  const path = v.parse(PathSchema, target.path);
  const workspace = await requireWorkspace(actor, target.slug);
  const { baseRevision } = options;

  const contentOf = (kind: WikiNodeKind, row?: PageRow) => {
    const content = {
      body: bodyOf(row?.body),
      title: options.title ?? row?.title ?? titleFromPath(path),
    };

    if (content.body.length > maxBody) {
      throw new ApiError(400, "invalid_request", "Wiki page is too long");
    }

    if (kind === "folder" && content.body !== "") {
      throw new ApiError(400, "invalid_request", "A folder has no body");
    }

    return content;
  };

  const { changed, id } = await db.begin(async (tx) => {
    const lockPage = async () => {
      const [row] = await tx<PageRow[]>`
        select id, kind, title, body_md as body, revision from wiki_pages
        where workspace_id = ${workspace.id} and path = ${path}
          and deleted_at is null
        for update
      `;

      return row;
    };

    let page = await lockPage();
    const creates = (baseRevision ?? 0) === 0;

    if (page === undefined && creates) {
      const kind = options.kind ?? "page";
      const newId = options.id ?? Bun.randomUUIDv7();
      const content = contentOf(kind);

      await lockTree(tx, workspace.id);
      await ensureParents(tx, actor, workspace.id, path);

      const node = {
        id: newId,
        kind,
        path,
        sortKey: options.sortKey ?? null,
        workspaceId: workspace.id,
      };

      if (await insertNode(tx, actor, node, content)) {
        return { changed: true, id: newId };
      }

      page = await lockPage();
    }

    if (page === undefined) {
      throw creates
        ? new ApiError(409, "conflict", "A wiki page with this id exists")
        : notFound(`Wiki page ${path}`);
    }

    if (options.id !== undefined && options.id !== page.id) {
      throw new ApiError(
        409,
        "conflict",
        `${path} is now a different page`,
        await selectPage(tx, page.id)
      );
    }

    if (baseRevision !== undefined && baseRevision !== page.revision) {
      throw new ApiError(
        409,
        "conflict",
        baseRevision === 0
          ? `${path} already exists`
          : `${path} changed since revision ${baseRevision}`,
        await selectPage(tx, page.id)
      );
    }

    if (options.kind !== undefined && options.kind !== page.kind) {
      throw new ApiError(
        409,
        "conflict",
        `${path} is a ${page.kind}`,
        await selectPage(tx, page.id)
      );
    }

    const next = contentOf(page.kind, page);

    if (next.body === page.body && next.title === page.title) {
      return { changed: false, id: page.id };
    }

    await saveRevision(tx, actor, page, { merge: true, next });

    return { changed: true, id: page.id };
  });

  if (changed) {
    pageChanged(workspace.id, id);
    void refreshEmbedding("wiki", id);
  }

  return await selectPage(db, id);
};

export const putPage = async (
  actor: Actor,
  target: Target,
  { body, ...options }: v.InferOutput<typeof PutPageSchema>
) => await writePage(actor, target, options, (current = "") => body ?? current);

const appendText = (body: string, text: string) =>
  body === "" || body.endsWith("\n") ? body + text : `${body}\n${text}`;

export const patchPage = async (
  actor: Actor,
  target: Target,
  { append, ...options }: v.InferOutput<typeof PatchPageSchema>
) =>
  await writePage(actor, target, options, (body = "") =>
    append === undefined ? body : appendText(body, append)
  );

export const listPages = async (actor: Actor, slug: string, prefix: string) => {
  const workspace = await requireWorkspace(actor, slug);

  return await db<WikiPageSummary[]>`
    select ${summaryColumns} from wiki_pages w
    where w.workspace_id = ${workspace.id} and w.deleted_at is null
      and starts_with(w.path, ${prefix.toLowerCase()})
    order by w.path
  `;
};

const findByPath = async (actor: Actor, slug: string, path: string) => {
  const workspace = await requireWorkspace(actor, slug);

  const [page] = await db<{ id: string; path: string }[]>`
    select id, path from wiki_pages
    where workspace_id = ${workspace.id} and path = ${path.toLowerCase()}
      and deleted_at is null
  `;

  if (page === undefined) {
    throw notFound(`Wiki page ${path.toLowerCase()}`);
  }

  return { ...page, workspaceId: workspace.id };
};

export const getPage = async (actor: Actor, slug: string, path: string) => {
  const page = await findByPath(actor, slug, path);

  return await selectPage(db, page.id);
};

const trashSubtree = async (
  actor: Actor,
  page: { id: string; workspaceId: string }
) => {
  const trashed = await db.begin(async (tx) => {
    await lockTree(tx, page.workspaceId);

    const [root] = await tx<{ path: string }[]>`
      select path from wiki_pages
      where id = ${page.id} and deleted_at is null
    `;

    if (root === undefined) {
      throw notFound("Wiki page");
    }

    return await tx<{ id: string }[]>`
      update wiki_pages w set
        deleted_at = now(),
        deleted_by = ${actor.userId},
        deleted_with = case when w.id = ${page.id} then null else ${page.id}::uuid end
      where w.workspace_id = ${page.workspaceId} and w.deleted_at is null and (
        w.path = ${root.path}
        or starts_with(w.path, ${root.path}::text || '/')
      )
      returning w.id
    `;
  });

  for (const { id } of trashed) {
    pageChanged(page.workspaceId, id);
  }
};

export const deletePage = async (actor: Actor, slug: string, path: string) => {
  await trashSubtree(actor, await findByPath(actor, slug, path));
};

export const findPageById = async (actor: Actor, id: string) => {
  const [page] = isUuid(id)
    ? await db<{ id: string; workspaceId: string }[]>`
        select id, workspace_id as "workspaceId"
        from wiki_pages where id = ${id} and deleted_at is null
      `
    : [];

  if (
    page === undefined ||
    (await workspaceRole(actor, page.workspaceId)) === null
  ) {
    throw notFound("Wiki page");
  }

  return page;
};

export const deletePageById = async (actor: Actor, id: string) => {
  await trashSubtree(actor, await findPageById(actor, id));
};

export const getPageById = async (actor: Actor, id: string) => {
  const page = await findPageById(actor, id);

  return await selectPage(db, page.id);
};

export const movePage = async (
  actor: Actor,
  pageId: string,
  { path, sortKey }: v.InferOutput<typeof MovePageSchema>
) => {
  const { workspaceId } = await findPageById(actor, pageId);

  const changed = await db.begin(async (tx) => {
    await lockTree(tx, workspaceId);

    const [page] = await tx<{ path: string; sortKey: string }[]>`
      select path, sort_key as "sortKey" from wiki_pages
      where id = ${pageId} and deleted_at is null
      for update
    `;

    if (page === undefined) {
      throw notFound("Wiki page");
    }

    if (path.startsWith(`${page.path}/`)) {
      throw new ApiError(
        400,
        "invalid_request",
        "A page cannot move into its own subtree"
      );
    }

    const moves = path !== page.path;

    if (moves) {
      const [taken] = await tx<{ path: string }[]>`
        select w.path from wiki_pages w
        where w.workspace_id = ${workspaceId} and w.deleted_at is null and (
          w.path = ${path}
          or starts_with(w.path, ${path}::text || '/')
        )
          and not (
            w.path = ${page.path}
            or starts_with(w.path, ${page.path}::text || '/')
          )
        limit 1
      `;

      if (taken !== undefined) {
        throw new ApiError(409, "conflict", `${taken.path} already exists`);
      }

      const [subtree] = await tx<{ longest: number }[]>`
        select max(length(w.path)) as longest from wiki_pages w
        where w.workspace_id = ${workspaceId} and w.deleted_at is null and (
          w.path = ${page.path}
          or starts_with(w.path, ${page.path}::text || '/')
        )
      `;

      const longest = (subtree?.longest ?? 0) - page.path.length + path.length;

      if (longest > maxPath) {
        throw new ApiError(
          400,
          "invalid_request",
          `A page inside would get a ${longest}-character path; paths are limited to ${maxPath} characters`
        );
      }

      await ensureParents(tx, actor, workspaceId, path);
    }

    const nextKey =
      sortKey ??
      (parentOf(path) === parentOf(page.path)
        ? page.sortKey
        : await lastSortKey(tx, workspaceId, parentOf(path)));

    if (!moves && nextKey === page.sortKey) {
      return false;
    }

    await tx`
      update wiki_pages w set path = ${path} || substr(w.path, ${page.path.length + 1})
      where w.workspace_id = ${workspaceId} and w.deleted_at is null and (
        w.path = ${page.path}
        or starts_with(w.path, ${page.path}::text || '/')
      )
    `;
    await tx`update wiki_pages set sort_key = ${nextKey} where id = ${pageId}`;

    return true;
  });

  if (changed) {
    pageChanged(workspaceId, pageId);
  }

  return await selectPage(db, pageId);
};

const trashedPage = "Wiki page in the trash";

const findTrashedPage = async (actor: Actor, id: string, root: boolean) => {
  const [page] = isUuid(id)
    ? await db<{ id: string; workspaceId: string }[]>`
        select id, workspace_id as "workspaceId" from wiki_pages
        where id = ${id} and deleted_at is not null
          and (not ${root} or deleted_with is null)
      `
    : [];

  const role =
    page === undefined ? null : await workspaceRole(actor, page.workspaceId);

  if (page === undefined || role === null) {
    throw notFound(trashedPage);
  }

  return { ...page, role };
};

const restoredSuffix = (attempt: number) => {
  if (attempt === 1) {
    return "";
  }

  return attempt === 2 ? "-restored" : `-restored-${attempt - 1}`;
};

const freePath = async (
  tx: TransactionSQL,
  workspaceId: string,
  { inside, path }: { inside: number; path: string }
) => {
  const segmentStart = path.lastIndexOf("/") + 1;

  for (let attempt = 1; ; attempt += 1) {
    const suffix = restoredSuffix(attempt);
    const room = maxPath - inside - suffix.length;

    if (room <= segmentStart) {
      throw new ApiError(
        400,
        "invalid_request",
        `${path} is taken and a restored copy would exceed ${maxPath} characters; move the page that took it first`
      );
    }

    const candidate = path.slice(0, room) + suffix;

    // oxlint-disable-next-line no-await-in-loop -- Each candidate is checked after the previous one was taken.
    const [taken] = await tx<{ path: string }[]>`
      select w.path from wiki_pages w
      where w.workspace_id = ${workspaceId} and w.deleted_at is null and (
        w.path = ${candidate}
        or starts_with(w.path, ${candidate}::text || '/')
      )
      limit 1
    `;

    if (taken === undefined) {
      return candidate;
    }
  }
};

export const restorePage = async (actor: Actor, pageId: string) => {
  const { workspaceId } = await findTrashedPage(actor, pageId, false);

  await db.begin(async (tx) => {
    await lockTree(tx, workspaceId);

    const [node] = await tx<{ batch: string; path: string; sortKey: string }[]>`
      select path, sort_key as "sortKey", coalesce(deleted_with, id) as batch
      from wiki_pages
      where id = ${pageId} and deleted_at is not null
      for update
    `;

    if (node === undefined) {
      throw notFound(trashedPage);
    }

    const restored = db`
      (w.id = ${node.batch} or w.deleted_with = ${node.batch})
      and (w.path = ${node.path} or starts_with(w.path, ${node.path}::text || '/'))
    `;

    const [subtree] = await tx<{ longest: number }[]>`
      select max(length(w.path)) as longest from wiki_pages w
      where ${restored}
    `;

    const path = await freePath(tx, workspaceId, {
      inside: (subtree?.longest ?? node.path.length) - node.path.length,
      path: node.path,
    });

    await ensureParents(tx, actor, workspaceId, path);

    const sortKey =
      path === node.path
        ? node.sortKey
        : await lastSortKey(tx, workspaceId, parentOf(path));

    await tx`
      update wiki_pages w set
        path = ${path} || substr(w.path, ${node.path.length + 1}),
        deleted_at = null, deleted_by = null, deleted_with = null
      where ${restored}
    `;
    await tx`update wiki_pages set sort_key = ${sortKey} where id = ${pageId}`;
  });

  pageChanged(workspaceId, pageId);

  return await selectPage(db, pageId);
};

export const purgePage = async (actor: Actor, pageId: string) => {
  const page = await findTrashedPage(actor, pageId, true);

  requireRole(page.role, "admin");

  const [purged] = await db<{ count: number; storageKeys: string[] }[]>`
    with purged as (
      delete from wiki_pages
      where id = ${pageId} and deleted_at is not null and deleted_with is null
      returning id
    )
    select (select count(*)::int from purged) as count,
      array(
        select a.storage_key from attachments a
        join wiki_pages w on w.id = a.wiki_page_id
        where w.id in (select id from purged)
          or w.deleted_with in (select id from purged)
      ) as "storageKeys"
  `;

  if (purged?.count !== 1) {
    throw notFound(trashedPage);
  }

  await deleteObjects(purged.storageKeys);
  pageChanged(page.workspaceId, pageId);
};

const revisionColumns = db`
  r.revision, r.title, r.created_at as "createdAt",
  r.updated_at as "updatedAt", r.via_token_id is not null as "viaApi",
  ${userRef} as author
`;

export const listRevisions = async (actor: Actor, pageId: string) => {
  const page = await findPageById(actor, pageId);

  return await db<WikiRevisionSummary[]>`
    select ${revisionColumns}
    from wiki_revisions r join users u on u.id = r.author_id
    where r.page_id = ${page.id}
    order by r.revision desc
  `;
};

export const getRevision = async (
  actor: Actor,
  pageId: string,
  revision: string
) => {
  const page = await findPageById(actor, pageId);

  const [row] = await db<WikiRevision[]>`
    select ${revisionColumns}, r.body_md as body
    from wiki_revisions r join users u on u.id = r.author_id
    where r.page_id = ${page.id}
      and r.revision = ${v.parse(RevisionSchema, revision)}
  `;

  if (row === undefined) {
    throw notFound("Revision");
  }

  return row;
};

export const restoreRevision = async (
  actor: Actor,
  pageId: string,
  revision: string
) => {
  const page = await findPageById(actor, pageId);
  const number = v.parse(RevisionSchema, revision);

  const changed = await db.begin(async (tx) => {
    const [[current], [target]] = await Promise.all([
      tx<PageRow[]>`
        select id, kind, title, body_md as body, revision from wiki_pages
        where id = ${page.id} and deleted_at is null
        for update
      `,
      tx<Content[]>`
        select title, body_md as body from wiki_revisions
        where page_id = ${page.id} and revision = ${number}
      `,
    ]);

    if (current === undefined) {
      throw notFound("Wiki page");
    }

    if (target === undefined) {
      throw notFound("Revision");
    }

    if (target.body === current.body && target.title === current.title) {
      return false;
    }

    await saveRevision(tx, actor, current, { merge: false, next: target });

    return true;
  });

  if (changed) {
    pageChanged(page.workspaceId, page.id);
    void refreshEmbedding("wiki", page.id);
  }

  return await selectPage(db, page.id);
};
