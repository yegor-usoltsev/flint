import type { TransactionSQL } from "bun";

import type { Me } from "~/lib/api-types";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { listWorkspaces } from "~/server/workspaces.server";

export interface GiteaProfile {
  avatarUrl: string;
  email: string;
  giteaId: string;
  name: string;
  username: string;
}

export const lockUsers = async (tx: TransactionSQL) => {
  await tx`select pg_advisory_xact_lock(hashtext('flint_users'))`;
};

export const signIn = async (profile: GiteaProfile) =>
  await db.begin(async (tx) => {
    await lockUsers(tx);

    const [user] = await tx<{ id: string }[]>`
      insert into users (
        id, gitea_id, username, name, email, avatar_url, is_instance_admin
      )
      values (
        ${Bun.randomUUIDv7()},
        ${profile.giteaId},
        ${profile.username},
        ${profile.name},
        ${profile.email},
        ${profile.avatarUrl},
        not exists (select 1 from users)
      )
      on conflict (gitea_id) do update set
        username = excluded.username,
        name = excluded.name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        updated_at = now()
      returning id
    `;

    if (user === undefined) {
      throw new Error("User upsert returned no row");
    }

    await tx`
      insert into workspace_members (workspace_id, user_id, role)
      select workspace_id, ${user.id}, role from invites
      where gitea_id = ${profile.giteaId}
      on conflict do nothing
    `;
    await tx`
      delete from invites where gitea_id = ${profile.giteaId}
    `;

    return user.id;
  });

export const getMe = async (actor: Actor): Promise<Me> => {
  const [[user], workspaces] = await Promise.all([
    db<Omit<Me, "giteaUrl" | "trashDays" | "workspaces">[]>`
      select id, username, display_name as "displayName", email,
        avatar_url as "avatarUrl",
        is_instance_admin as "isInstanceAdmin"
      from users where id = ${actor.userId}
    `,
    listWorkspaces(actor),
  ]);

  if (user === undefined) {
    throw new Error(`User ${actor.userId} not found`);
  }

  return {
    ...user,
    giteaUrl: env.GITEA_PUBLIC_URL,
    trashDays: env.TRASH_RETENTION_DAYS,
    workspaces,
  };
};
