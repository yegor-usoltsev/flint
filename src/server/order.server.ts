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

  const ids = rows.flatMap((row) => (row.id === id ? [] : [row.id]));
  const index = after === null ? 0 : ids.indexOf(after) + 1;

  if (after !== null && index === 0) {
    throw notFound(table === "labels" ? "Label" : "Project");
  }

  ids.splice(index, 0, id);

  await tx`
    update ${tx(table)} t set position = o.ordinality - 1
    from unnest(${tx.array(ids, "uuid")}) with ordinality as o(id, ordinality)
    where t.id = o.id
  `;
};
