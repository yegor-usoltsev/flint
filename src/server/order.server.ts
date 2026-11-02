import type { TransactionSQL } from "bun";

import { notFound } from "~/server/access.server";

export const moveAfter = async (
  tx: TransactionSQL,
  table: "labels" | "projects",
  workspaceId: string,
  id: string,
  after: string | null
) => {
  await tx`select 1 from workspaces where id = ${workspaceId} for update`;

  const rows = await tx<{ id: string }[]>`
    select id from ${tx(table)} where workspace_id = ${workspaceId}
    order by position, created_at, id
  `;

  const moving = id.toLowerCase();
  const ids = rows.flatMap((row) => (row.id === moving ? [] : [row.id]));
  const index = after === null ? 0 : ids.indexOf(after.toLowerCase()) + 1;

  if (after !== null && index === 0) {
    throw notFound(table === "labels" ? "Label" : "Project");
  }

  ids.splice(index, 0, moving);

  await tx`
    update ${tx(table)} t set position = o.ordinality - 1
    from unnest(${tx.array(ids, "uuid")}) with ordinality as o(id, ordinality)
    where t.id = o.id
  `;
};
