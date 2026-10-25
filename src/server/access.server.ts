// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Role, Workspace } from "~/lib/api-types";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";

export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} not found`);

export const isUuid = (value: string) =>
  v.is(v.pipe(v.string(), v.uuid()), value);

export const UniqueViolationSchema = v.object({ errno: v.literal("23505") });

export const workspaceColumns = db`
  w.id, w.slug, w.name, w.color,
  case when w.logo_attachment_id is null then null
    else '/files/' || w.logo_attachment_id end as "logoUrl"
`;

export const userRef = db`
  json_build_object(
    'id', u.id, 'username', u.username, 'displayName', u.display_name,
    'avatarUrl', u.avatar_url
  )
`;

export const requireRole = (role: Role, required: Role) => {
  if (required === "admin" && role !== "admin") {
    throw new ApiError(403, "forbidden", "Only workspace admins can do this");
  }
};

export const workspaceRole = async (actor: Actor, workspaceId: string) => {
  if (
    actor.workspaceIds !== undefined &&
    !actor.workspaceIds.includes(workspaceId)
  ) {
    return null;
  }

  const [row] = await db<{ role: Role | null }[]>`
    select case when u.is_instance_admin then 'admin' else m.role end as role
    from users u
    left join workspace_members m
      on m.user_id = u.id and m.workspace_id = ${workspaceId}
    where u.id = ${actor.userId}
  `;

  return row?.role ?? null;
};

export const requireWorkspace = async (
  actor: Actor,
  slug: string,
  required: Role = "member"
): Promise<Workspace> => {
  const [workspace] = await db<Omit<Workspace, "role">[]>`
    select ${workspaceColumns} from workspaces w where w.slug = ${slug}
  `;

  const role =
    workspace === undefined ? null : await workspaceRole(actor, workspace.id);

  if (workspace === undefined || role === null) {
    throw notFound("Workspace");
  }

  requireRole(role, required);

  return { ...workspace, role };
};
