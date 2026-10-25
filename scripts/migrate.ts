import { readdir } from "node:fs/promises";
import path from "node:path";

import { db } from "~/server/db.server";
import { log } from "~/server/log.server";

const dir = path.join(import.meta.dir, "../migrations");
const entries = await readdir(dir);
const files = entries.filter((file) => file.endsWith(".sql"));

await db.begin(async (tx) => {
  await tx`select pg_advisory_xact_lock(hashtext('flint_migrations'))`;
  await tx`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const rows: { name: string }[] = await tx`select name from schema_migrations`;
  const applied = new Set(rows.map((row) => row.name));

  for (const file of files.toSorted()) {
    if (!applied.has(file)) {
      // oxlint-disable-next-line no-await-in-loop -- Migrations apply in order.
      await tx.file(path.join(dir, file));
      // oxlint-disable-next-line no-await-in-loop -- Migrations apply in order.
      await tx`insert into schema_migrations (name) values (${file})`;
      log.info({ migration: file }, "applied migration");
    }
  }
});

await db.close();
