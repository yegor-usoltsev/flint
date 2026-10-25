import { db } from "~/server/db.server";
import { log } from "~/server/log.server";
import { deleteObjects, s3 } from "~/server/s3.server";

const grace = 24 * 60 * 60 * 1000;

export interface SweepOptions {
  before?: Date;
  prefix?: string;
}

export const sweepStorage = async ({
  before = new Date(Date.now() - grace),
  prefix = "",
}: SweepOptions = {}) => {
  const rows = await db<{ storageKey: string }[]>`
    delete from attachments a
    where a.issue_id is null and a.wiki_page_id is null
      and a.created_at < ${before}
      and a.storage_key like ${`${prefix}%`}
      and not exists (
        select 1 from workspaces w where w.logo_attachment_id = a.id
      )
    returning a.storage_key as "storageKey"
  `;

  await deleteObjects(rows.map((row) => row.storageKey));

  let objects = 0;
  let startAfter: string | undefined;

  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each page starts after the previous one's last key.
    const page = await s3.list({ maxKeys: 1000, prefix, startAfter });
    const contents = page.contents ?? [];
    const old: string[] = [];

    for (const { key, lastModified } of contents) {
      if (lastModified !== undefined && new Date(lastModified) < before) {
        old.push(key);
      }
    }

    if (old.length > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Pages are checked one at a time to bound memory.
      const known = await db<{ key: string }[]>`
        select storage_key as key from attachments
        where storage_key = any(${db.array(old, "text")})
      `;

      const kept = new Set(known.map(({ key }) => key));

      const orphans = old.filter((key) => !kept.has(key));

      // oxlint-disable-next-line eslint/no-await-in-loop -- Deleting before the next page keeps the batch small.
      await deleteObjects(orphans);
      objects += orphans.length;
    }

    startAfter = contents.at(-1)?.key;

    if (page.isTruncated !== true || startAfter === undefined) {
      break;
    }
  }

  const result = { objects, rows: rows.length };

  log.info(result, "Storage sweep finished");

  return result;
};
