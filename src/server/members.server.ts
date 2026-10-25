import type { TransactionSQL } from "bun";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Member, Role } from "~/lib/api-types";
import {
  notFound,
  requireRole,
  requireWorkspace,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { disconnect, publish, publishToUser } from "~/server/realtime.server";
import { lockUsers } from "~/server/users.server";

const RoleSchema = v.picklist(["admin", "member"]);

export const AddMemberSchema = v.object({
  role: v.optional(RoleSchema, "member"),
  username: v.pipe(
    v.string(),
    v.trim(),
    v.transform((name) => name.replace(/^@/u, "")),
    v.regex(/^[\w.-]{1,40}$/u, "Enter a Gitea username")
  ),
});

export const UpdateMemberSchema = v.object({ role: RoleSchema });

const memberChanged = (workspaceId: string, username: string) => {
  publish(workspaceId, { entity: "member", id: username, projectId: null });
};

const lastAdmin = () =>
  new ApiError(409, "last_admin", "A workspace needs at least one admin");

export const listMembers = async (actor: Actor, slug: string) => {
  const workspace = await requireWorkspace(actor, slug);

  return await db<Member[]>`
    select * from (
      select u.id as "userId", u.username, u.display_name as "displayName",
        u.avatar_url as "avatarUrl", m.role, false as pending,
        m.created_at as "joinedAt"
      from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = ${workspace.id}
      union all
      select null, i.gitea_username, i.gitea_username, '', i.role, true,
        i.created_at
      from invites i
      where i.workspace_id = ${workspace.id}
    ) members
    order by pending, lower(username)
  `;
};

const findMembership = async (
  tx: TransactionSQL,
  workspaceId: string,
  username: string
) => {
  const [row] = await tx<{ role: Role; userId: string }[]>`
    select m.user_id as "userId", m.role
    from workspace_members m join users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}
      and lower(u.username) = lower(${username})
  `;

  return row;
};

const lockAdmins = async (tx: TransactionSQL, workspaceId: string) => {
  const admins = await tx<{ user_id: string }[]>`
    select user_id from workspace_members
    where workspace_id = ${workspaceId} and role = 'admin'
    for update
  `;

  return admins.length;
};

export const addMember = async (
  actor: Actor,
  slug: string,
  { role, username }: v.InferOutput<typeof AddMemberSchema>
) => {
  const workspace = await requireWorkspace(actor, slug, "admin");

  const member = await db.begin(async (tx): Promise<Member> => {
    await lockUsers(tx);

    const [user] = await tx<Omit<Member, "joinedAt" | "pending" | "role">[]>`
      select id as "userId", username, display_name as "displayName",
        avatar_url as "avatarUrl"
      from users where lower(username) = lower(${username})
      order by updated_at desc
      limit 1
    `;

    if (user !== undefined) {
      const [added] = await tx<{ joinedAt: string }[]>`
        insert into workspace_members (workspace_id, user_id, role)
        values (${workspace.id}, ${user.userId}, ${role})
        on conflict do nothing
        returning created_at as "joinedAt"
      `;

      if (added === undefined) {
        throw new ApiError(409, "conflict", `@${user.username} is a member`);
      }

      return { ...user, joinedAt: added.joinedAt, pending: false, role };
    }

    const [invited] = await tx<{ joinedAt: string }[]>`
      insert into invites (
        id, workspace_id, gitea_username, role, created_by
      )
      values (
        ${Bun.randomUUIDv7()}, ${workspace.id}, ${username}, ${role},
        ${actor.userId}
      )
      on conflict do nothing
      returning created_at as "joinedAt"
    `;

    if (invited === undefined) {
      throw new ApiError(409, "conflict", `@${username} is already invited`);
    }

    return {
      avatarUrl: "",
      displayName: username,
      joinedAt: invited.joinedAt,
      pending: true,
      role,
      userId: null,
      username,
    };
  });

  memberChanged(workspace.id, member.username);

  if (member.userId !== null) {
    publishToUser(member.userId, {
      entity: "member",
      id: member.username,
      projectId: null,
    });
  }

  return member;
};

export const updateMember = async (
  actor: Actor,
  slug: string,
  username: string,
  { role }: v.InferOutput<typeof UpdateMemberSchema>
) => {
  const workspace = await requireWorkspace(actor, slug, "admin");

  await db.begin(async (tx) => {
    await lockUsers(tx);

    const admins = await lockAdmins(tx, workspace.id);
    const member = await findMembership(tx, workspace.id, username);

    if (member === undefined) {
      const invites = await tx<{ id: string }[]>`
        update invites set role = ${role}
        where workspace_id = ${workspace.id}
          and lower(gitea_username) = lower(${username})
        returning id
      `;

      if (invites.length === 0) {
        throw notFound("Member");
      }

      return;
    }

    if (member.role === "admin" && role === "member" && admins === 1) {
      throw lastAdmin();
    }

    await tx`
      update workspace_members set role = ${role}
      where workspace_id = ${workspace.id} and user_id = ${member.userId}
    `;
  });

  memberChanged(workspace.id, username);

  const members = await listMembers(actor, slug);

  const updated = members.find(
    (member) => member.username.toLowerCase() === username.toLowerCase()
  );

  if (updated === undefined) {
    throw notFound("Member");
  }

  return updated;
};

export const removeMember = async (
  actor: Actor,
  slug: string,
  username: string
) => {
  const workspace = await requireWorkspace(actor, slug);

  const removedId = await db.begin(async (tx) => {
    await lockUsers(tx);

    const admins = await lockAdmins(tx, workspace.id);
    const member = await findMembership(tx, workspace.id, username);

    if (member?.userId !== actor.userId) {
      requireRole(workspace.role, "admin");
    }

    if (member === undefined) {
      const invites = await tx<{ id: string }[]>`
        delete from invites
        where workspace_id = ${workspace.id}
          and lower(gitea_username) = lower(${username})
        returning id
      `;

      if (invites.length === 0) {
        throw notFound("Member");
      }

      return null;
    }

    if (member.role === "admin" && admins === 1) {
      throw lastAdmin();
    }

    await tx`
      delete from workspace_members
      where workspace_id = ${workspace.id} and user_id = ${member.userId}
    `;

    return member.userId;
  });

  memberChanged(workspace.id, username);

  if (
    removedId !== null &&
    (await workspaceRole({ userId: removedId }, workspace.id)) === null
  ) {
    disconnect(workspace.id, removedId);
  }
};
