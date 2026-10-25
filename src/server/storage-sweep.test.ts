import { beforeEach, expect, test } from "bun:test";

import { db } from "~/server/db.server";
import { deleteObjects, s3 } from "~/server/s3.server";
import { sweepStorage } from "~/server/storage-sweep.server";
import { putPage } from "~/server/wiki.server";
import { createWorkspace } from "~/server/workspaces.server";

import { createUser, resetDatabase } from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
});

const stored = async (prefix: string) => {
  const page = await s3.list({ prefix });

  return (page.contents ?? []).map(({ key }) => key).toSorted();
};

const setup = async () => {
  const userId = await createUser("root");
  const actor = { userId };

  const workspace = await createWorkspace(actor, {
    name: "Acme",
    slug: "acme",
  });

  const page = await putPage(
    actor,
    { path: "docs", slug: "acme" },
    {
      body: "",
    }
  );

  const prefix = `${workspace.id}/`;

  const attach = async (name: string, pageId: string | null) => {
    const id = Bun.randomUUIDv7();
    const key = `${prefix}${name}`;

    await s3.write(key, name);
    await db`
      insert into attachments (
        id, workspace_id, wiki_page_id, uploader_id, storage_key, filename,
        content_type, size_bytes
      ) values (
        ${id}, ${workspace.id}, ${pageId}, ${userId}, ${key}, ${name},
        'text/plain', ${name.length}
      )
    `;

    return id;
  };

  await attach("page-file", page.id);
  await db`
    update workspaces set logo_attachment_id = ${await attach("logo", null)}
    where id = ${workspace.id}
  `;
  await attach("replaced-logo", null);
  await s3.write(`${prefix}orphan`, "orphan");

  return prefix;
};

test("the sweep keeps young objects and rows", async () => {
  const prefix = await setup();

  try {
    expect(await sweepStorage({ prefix })).toEqual({ objects: 0, rows: 0 });
    expect(await stored(prefix)).toHaveLength(4);
  } finally {
    await deleteObjects(await stored(prefix));
  }
});

test("the sweep deletes objects without rows and unused logo rows", async () => {
  const prefix = await setup();

  try {
    const result = await sweepStorage({
      before: new Date(Date.now() + 60_000),
      prefix,
    });

    expect(result).toEqual({ objects: 1, rows: 1 });
    expect(await stored(prefix)).toEqual([
      `${prefix}logo`,
      `${prefix}page-file`,
    ]);

    const rows = await db<{ filename: string }[]>`
      select filename from attachments order by filename
    `;

    expect(rows.map(({ filename }) => filename)).toEqual(["logo", "page-file"]);
  } finally {
    await deleteObjects(await stored(prefix));
  }
});
