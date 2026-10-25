// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Label, LabelSummary } from "~/lib/api-types";
import { colors } from "~/lib/colors";
import {
  isUuid,
  notFound,
  requireWorkspace,
  UniqueViolationSchema,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { publish } from "~/server/realtime.server";

const NameSchema = v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(40));
const ColorSchema = v.picklist(colors);

export const CreateLabelSchema = v.object({
  color: ColorSchema,
  name: NameSchema,
});

export const UpdateLabelSchema = v.object({
  color: v.optional(ColorSchema),
  name: v.optional(NameSchema),
});

const nameTaken = (name: string) =>
  new ApiError(409, "conflict", `Label “${name}” exists`);

const findLabel = async (actor: Actor, id: string) => {
  const [label] = isUuid(id)
    ? await db<{ workspaceId: string }[]>`
        select workspace_id as "workspaceId" from labels where id = ${id}
      `
    : [];

  if (
    label === undefined ||
    (await workspaceRole(actor, label.workspaceId)) === null
  ) {
    throw notFound("Label");
  }

  return label.workspaceId;
};

const labelChanged = (workspaceId: string, id: string) => {
  publish(workspaceId, { entity: "label", id, projectId: null });
};

export const listLabels = async (actor: Actor, slug: string) => {
  const workspace = await requireWorkspace(actor, slug);

  return await db<LabelSummary[]>`
    select l.id, l.name, l.color,
      (
        select count(*)::int from issue_labels il
        join issues i on i.id = il.issue_id
        where il.label_id = l.id and i.deleted_at is null
      ) as "issueCount"
    from labels l
    where l.workspace_id = ${workspace.id}
    order by lower(l.name)
  `;
};

export const createLabel = async (
  actor: Actor,
  slug: string,
  { color, name }: v.InferOutput<typeof CreateLabelSchema>
) => {
  const workspace = await requireWorkspace(actor, slug);

  const [label] = await db<Label[]>`
    insert into labels (id, workspace_id, name, color)
    values (${Bun.randomUUIDv7()}, ${workspace.id}, ${name}, ${color})
    on conflict (workspace_id, lower(name)) do nothing
    returning id, name, color
  `;

  if (label === undefined) {
    throw nameTaken(name);
  }

  labelChanged(workspace.id, label.id);

  return label;
};

export const updateLabel = async (
  actor: Actor,
  id: string,
  changes: v.InferOutput<typeof UpdateLabelSchema>
) => {
  const workspaceId = await findLabel(actor, id);

  try {
    const [label] = await db<Label[]>`
      update labels set
        name = coalesce(${changes.name ?? null}, name),
        color = coalesce(${changes.color ?? null}, color)
      where id = ${id}
      returning id, name, color
    `;

    if (label === undefined) {
      throw notFound("Label");
    }

    labelChanged(workspaceId, id);

    return label;
  } catch (error) {
    if (v.is(UniqueViolationSchema, error)) {
      throw nameTaken(changes.name ?? "");
    }

    throw error;
  }
};

export const deleteLabel = async (actor: Actor, id: string) => {
  const workspaceId = await findLabel(actor, id);

  const issues = await db.begin(async (tx) => {
    const changed = await tx<{ id: string; projectId: string }[]>`
      update issues i set version = version + 1, updated_at = now()
      from issue_labels l
      where l.label_id = ${id} and l.issue_id = i.id
      returning i.id, i.project_id as "projectId"
    `;

    await tx`
      insert into issue_events (
        id, issue_id, actor_id, via_token_id, kind, from_value
      )
      select e.id, e.issue_id, ${actor.userId}, ${actor.tokenId ?? null},
        'label_removed', to_jsonb(${id}::text)
      from jsonb_to_recordset(${changed.map((issue) => ({
        id: Bun.randomUUIDv7(),
        issue_id: issue.id,
      }))}::jsonb) as e(id uuid, issue_id uuid)
    `;
    await tx`delete from labels where id = ${id}`;

    return changed;
  });

  labelChanged(workspaceId, id);

  for (const issue of issues) {
    publish(workspaceId, {
      entity: "issue",
      id: issue.id,
      projectId: issue.projectId,
    });
  }
};
