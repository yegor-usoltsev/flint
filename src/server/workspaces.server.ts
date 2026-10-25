// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Workspace } from "~/lib/api-types";
import { colors } from "~/lib/colors";
import { reservedSlugs } from "~/lib/workspace";
import {
  requireWorkspace,
  UniqueViolationSchema,
  workspaceColumns,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { uploadAttachment } from "~/server/attachments.server";
import { db } from "~/server/db.server";
import { addDemoData, insertDemoProject } from "~/server/demo-data.server";
import { closeWorkspace, publish } from "~/server/realtime.server";
import { deleteObjects } from "~/server/s3.server";

const NameSchema = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60));

const SlugSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "Slug must be lowercase letters, digits and single dashes"
  ),
  v.maxLength(40),
  v.check((slug) => !reservedSlugs.has(slug), "This slug is reserved")
);

const ColorSchema = v.picklist(colors);

export const CreateWorkspaceSchema = v.object({
  color: v.optional(ColorSchema),
  demo: v.optional(v.boolean()),
  name: NameSchema,
  slug: SlugSchema,
});

export const UpdateWorkspaceSchema = v.object({
  color: v.optional(ColorSchema),
  name: v.optional(NameSchema),
  slug: v.optional(SlugSchema),
});

const slugTaken = (slug: string) =>
  new ApiError(409, "conflict", `Slug “${slug}” is taken`);

export const listWorkspaces = async (actor: Actor) =>
  await db<Workspace[]>`
    select ${workspaceColumns},
      case when u.is_instance_admin then 'admin' else m.role end as role
    from workspaces w
    join users u on u.id = ${actor.userId}
    left join workspace_members m
      on m.workspace_id = w.id and m.user_id = u.id
    where (m.role is not null or u.is_instance_admin)
      and (
        ${actor.workspaceIds === undefined}
        or w.id = any(${db.array(actor.workspaceIds ?? [], "uuid")})
      )
    order by lower(w.name), w.slug
  `;

const workspaceChanged = (id: string) => {
  publish(id, { entity: "workspace", id, projectId: null });
};

export const deleteWorkspace = async (actor: Actor, slug: string) => {
  const workspace = await requireWorkspace(actor, slug, "admin");

  const keys = await db.begin(async (tx) => {
    const rows = await tx<{ storageKey: string }[]>`
      select storage_key as "storageKey" from attachments
      where workspace_id = ${workspace.id}
    `;

    await tx`
      delete from api_tokens t
      where t.restricted and not exists (
        select 1 from api_token_workspaces a
        where a.token_id = t.id and a.workspace_id <> ${workspace.id}
      )
      and exists (
        select 1 from api_token_workspaces a
        where a.token_id = t.id and a.workspace_id = ${workspace.id}
      )
    `;
    await tx`delete from workspaces where id = ${workspace.id}`;

    return rows.map((row) => row.storageKey);
  });

  await deleteObjects(keys);
  workspaceChanged(workspace.id);
  closeWorkspace(workspace.id);
};

export const createWorkspace = async (
  actor: Actor,
  {
    color = "indigo",
    demo = false,
    name,
    slug,
  }: v.InferOutput<typeof CreateWorkspaceSchema>
): Promise<Workspace> => {
  if (actor.workspaceIds !== undefined) {
    throw new ApiError(
      403,
      "forbidden",
      "A token restricted to workspaces cannot create workspaces"
    );
  }

  const id = Bun.randomUUIDv7();

  const demoKey = await db.begin(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      insert into workspaces (id, slug, name, color)
      values (${id}, ${slug}, ${name}, ${color})
      on conflict (slug) do nothing
      returning id
    `;

    if (inserted.length === 0) {
      throw slugTaken(slug);
    }

    await tx`
      insert into workspace_members (workspace_id, user_id, role)
      values (${id}, ${actor.userId}, 'admin')
    `;

    return demo ? await insertDemoProject(tx, id, name) : null;
  });

  if (demoKey !== null) {
    try {
      await addDemoData(actor, slug, demoKey);
    } catch (error) {
      await deleteWorkspace(actor, slug);
      throw error;
    }
  }

  return await requireWorkspace(actor, slug);
};

export const updateWorkspace = async (
  actor: Actor,
  slug: string,
  changes: v.InferOutput<typeof UpdateWorkspaceSchema>
) => {
  const workspace = await requireWorkspace(actor, slug, "admin");

  try {
    await db`
      update workspaces set
        name = coalesce(${changes.name ?? null}, name),
        slug = coalesce(${changes.slug ?? null}, slug),
        color = coalesce(${changes.color ?? null}, color),
        updated_at = now()
      where id = ${workspace.id}
    `;
  } catch (error) {
    if (v.is(UniqueViolationSchema, error)) {
      throw slugTaken(changes.slug ?? slug);
    }

    throw error;
  }

  workspaceChanged(workspace.id);

  return await requireWorkspace(actor, changes.slug ?? slug);
};

const replaceLogo = async (workspaceId: string, logoId: string | null) => {
  const previous = await db.begin(async (tx) => {
    const [row] = await tx<{ id: string | null }[]>`
      select logo_attachment_id as id from workspaces
      where id = ${workspaceId}
      for update
    `;

    await tx`
      update workspaces set logo_attachment_id = ${logoId}, updated_at = now()
      where id = ${workspaceId}
    `;

    return row?.id ?? null;
  });

  if (previous !== null) {
    const rows = await db<{ storageKey: string }[]>`
      delete from attachments where id = ${previous}
      returning storage_key as "storageKey"
    `;

    await deleteObjects(rows.map((row) => row.storageKey));
  }

  workspaceChanged(workspaceId);
};

export const setLogo = async (actor: Actor, slug: string, request: Request) => {
  const workspace = await requireWorkspace(actor, slug, "admin");
  const logo = await uploadAttachment(actor, { logoOf: slug }, request);

  await replaceLogo(workspace.id, logo.id);

  return await requireWorkspace(actor, slug);
};

export const removeLogo = async (actor: Actor, slug: string) => {
  const workspace = await requireWorkspace(actor, slug, "admin");

  await replaceLogo(workspace.id, null);

  return await requireWorkspace(actor, slug);
};
