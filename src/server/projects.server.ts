import type { TransactionSQL } from "bun";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type {
  Project,
  ProjectDetail,
  ProjectSummary,
  Status,
} from "~/lib/api-types";
import { colors } from "~/lib/colors";
import { projectIcons } from "~/lib/project-icons";
import {
  notFound,
  requireRole,
  requireWorkspace,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { publish } from "~/server/realtime.server";
import { deleteObjects } from "~/server/s3.server";

const NameSchema = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60));
const ColorSchema = v.picklist(colors);
const IconSchema = v.picklist(projectIcons);

export const CreateProjectSchema = v.object({
  color: ColorSchema,
  icon: v.optional(IconSchema),
  key: v.pipe(
    v.string(),
    v.trim(),
    v.toUpperCase(),
    v.regex(
      /^[A-Z][A-Z0-9]{1,4}$/u,
      "Key must be 2-5 letters or digits, starting with a letter"
    )
  ),
  name: NameSchema,
});

export const UpdateProjectSchema = v.object({
  color: v.optional(ColorSchema),
  icon: v.optional(IconSchema),
  name: v.optional(NameSchema),
});

const defaultStatuses = [
  { category: "backlog", color: "gray", name: "Backlog" },
  { category: "unstarted", color: "gray", name: "Todo" },
  { category: "started", color: "amber", name: "In Progress" },
  { category: "started", color: "green", name: "In Review" },
  { category: "completed", color: "indigo", name: "Done" },
  { category: "canceled", color: "gray", name: "Canceled" },
] as const;

const findStatuses = async (projectId: string) =>
  await db<Status[]>`
    select id, name, category, color, position from statuses
    where project_id = ${projectId}
    order by position
  `;

export const findProject = async (actor: Actor, key: string) => {
  const [project] = await db<(Project & { workspaceId: string })[]>`
    select p.id, p.key, p.name, p.icon, p.color,
      p.workspace_id as "workspaceId",
      w.slug as "workspaceSlug"
    from projects p join workspaces w on w.id = p.workspace_id
    where p.key = ${key.toUpperCase()}
  `;

  const role =
    project === undefined
      ? null
      : await workspaceRole(actor, project.workspaceId);

  if (project === undefined || role === null) {
    throw notFound(`Project ${key.toUpperCase()}`);
  }

  const { workspaceId, ...rest } = project;

  return { project: rest, role, workspaceId };
};

export const listProjects = async (actor: Actor, slug: string) => {
  const workspace = await requireWorkspace(actor, slug);

  return await db<ProjectSummary[]>`
    select p.id, p.key, p.name, p.icon, p.color,
      ${workspace.slug} as "workspaceSlug", p.created_at as "createdAt",
      (
        select count(*)::int from issues i join statuses s on s.id = i.status_id
        where i.project_id = p.id and i.deleted_at is null
          and s.category not in ('completed', 'canceled')
      ) as "openIssues"
    from projects p where p.workspace_id = ${workspace.id}
    order by lower(p.name), p.key
  `;
};

export const getProject = async (
  actor: Actor,
  key: string
): Promise<ProjectDetail> => {
  const { project } = await findProject(actor, key);

  return { ...project, statuses: await findStatuses(project.id) };
};

export const insertProject = async (
  tx: TransactionSQL,
  workspaceId: string,
  { color, icon = "box", key, name }: v.InferOutput<typeof CreateProjectSchema>
) => {
  const id = Bun.randomUUIDv7();

  const inserted = await tx<{ id: string }[]>`
    insert into projects (id, workspace_id, key, name, icon, color)
    values (${id}, ${workspaceId}, ${key}, ${name}, ${icon}, ${color})
    on conflict (key) do nothing
    returning id
  `;

  if (inserted.length === 0) {
    return null;
  }

  await tx`
    insert into statuses ${tx(
      defaultStatuses.map((status, position) => ({
        ...status,
        id: Bun.randomUUIDv7(),
        position,
        project_id: id,
      }))
    )}
  `;

  return id;
};

export const createProject = async (
  actor: Actor,
  slug: string,
  project: v.InferOutput<typeof CreateProjectSchema>
) => {
  const workspace = await requireWorkspace(actor, slug, "admin");
  const { key } = project;

  const id = await db.begin(
    async (tx) => await insertProject(tx, workspace.id, project)
  );

  if (id === null) {
    throw new ApiError(409, "conflict", `Project key ${key} is taken`);
  }

  publish(workspace.id, { entity: "project", id, projectId: id });

  return await getProject(actor, key);
};

export const updateProject = async (
  actor: Actor,
  key: string,
  changes: v.InferOutput<typeof UpdateProjectSchema>
) => {
  const { project, role, workspaceId } = await findProject(actor, key);

  requireRole(role, "admin");

  await db`
    update projects set
      name = coalesce(${changes.name ?? null}, name),
      color = coalesce(${changes.color ?? null}, color),
      icon = coalesce(${changes.icon ?? null}, icon),
      updated_at = now()
    where id = ${project.id}
  `;

  publish(workspaceId, {
    entity: "project",
    id: project.id,
    projectId: project.id,
  });

  return await getProject(actor, key);
};

export const deleteProject = async (actor: Actor, key: string) => {
  const { project, role, workspaceId } = await findProject(actor, key);

  requireRole(role, "admin");

  const keys = await db.begin(async (tx) => {
    const rows = await tx<{ storageKey: string }[]>`
      select a.storage_key as "storageKey"
      from attachments a join issues i on i.id = a.issue_id
      where i.project_id = ${project.id}
    `;

    await tx`delete from projects where id = ${project.id}`;

    return rows.map((row) => row.storageKey);
  });

  await deleteObjects(keys);

  publish(workspaceId, {
    entity: "project",
    id: project.id,
    projectId: project.id,
  });
};
