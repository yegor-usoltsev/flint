import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { Route as purgeIssueRoute } from "~/routes/api/v1/trash/issues/$issueKey";
import { Route as purgePageRoute } from "~/routes/api/v1/trash/wiki/$pageId";
import { Route as restorePageRoute } from "~/routes/api/v1/wiki/$pageId/restore";
import { Route as trashRoute } from "~/routes/api/v1/workspaces/$slug/trash";
import { ApiError } from "~/server/api.server";
import { db } from "~/server/db.server";
import { createIssue, deleteIssue } from "~/server/issues.server";
import { addMember } from "~/server/members.server";
import { createProject } from "~/server/projects.server";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- spyOn needs the module namespace.
import * as realtime from "~/server/realtime.server";
import { deleteObjects, s3 } from "~/server/s3.server";
import { purgeTrash } from "~/server/trash.server";
import {
  deletePage,
  getPage,
  listPages,
  purgePage,
  putPage,
  restorePage,
} from "~/server/wiki.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  callApi,
  createUser,
  resetDatabase,
  sessionCookieFor,
  stubGiteaUsers,
} from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  mock.restore();
});

const setup = async () => {
  const rootId = await createUser("root");
  const aliceId = await createUser("alice");
  const bobId = await createUser("bob");
  const root = { userId: rootId };
  const alice = { userId: aliceId };

  const workspace = await createWorkspace(root, { name: "Acme", slug: "acme" });

  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "member", username: "alice" });
  await addMember(root, "globex", { role: "member", username: "bob" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });

  return {
    alice,
    aliceCookie: await sessionCookieFor(aliceId),
    bobCookie: await sessionCookieFor(bobId),
    root,
    rootCookie: await sessionCookieFor(rootId),
    workspace,
  };
};

const newIssue = async (actor: { userId: string }, title: string) =>
  await createIssue(actor, "ENG", {
    assigneeId: null,
    description: "",
    labelIds: [],
    priority: 0,
    title,
  });

const trash = async (cookie: string, slug = "acme") =>
  await callApi(trashRoute, cookie, "GET", `/api/v1/workspaces/${slug}/trash`, {
    params: { slug },
  });

const purgeIssue = async (cookie: string) =>
  await callApi(
    purgeIssueRoute,
    cookie,
    "DELETE",
    "/api/v1/trash/issues/ENG-1",
    {
      params: { issueKey: "ENG-1" },
    }
  );

test("deleted issues wait in the trash until an admin purges them", async () => {
  const { alice, aliceCookie, bobCookie, rootCookie, workspace } =
    await setup();

  const issue = await newIssue(alice, "Gone");
  const key = `${workspace.id}/trash-test-${issue.id}`;

  await s3.write(key, "x");
  await db`
    insert into attachments (
      id, workspace_id, issue_id, uploader_id, storage_key, filename,
      content_type, size_bytes
    ) values (
      ${Bun.randomUUIDv7()}, ${workspace.id}, ${issue.id}, ${alice.userId},
      ${key}, 'x.txt', 'text/plain', 1
    )
  `;

  try {
    expect(await purgeIssue(rootCookie)).toMatchObject({
      body: { error: { code: "not_deleted" } },
      status: 409,
    });

    await deleteIssue(alice, "ENG-1");

    expect(await trash(aliceCookie)).toMatchObject({
      body: {
        issues: [
          { deletedBy: { username: "alice" }, key: "ENG-1", title: "Gone" },
        ],
        pages: [],
      },
      status: 200,
    });
    expect(await trash(bobCookie)).toMatchObject({ status: 404 });
    expect(await purgeIssue(aliceCookie)).toMatchObject({ status: 403 });
    expect(await purgeIssue(rootCookie)).toMatchObject({ status: 204 });
    expect(await s3.exists(key)).toBe(false);
    expect(await trash(aliceCookie)).toMatchObject({
      body: { issues: [], pages: [] },
    });
  } finally {
    await deleteObjects([key]);
  }
});

test("a deleted subtree frees its path and comes back beside what took it", async () => {
  const { alice, aliceCookie, rootCookie } = await setup();
  const target = { slug: "acme" };

  await putPage(alice, { ...target, path: "guides/setup" }, { body: "old" });
  await putPage(alice, { ...target, path: "guides/faq" }, { body: "faq" });
  await deletePage(alice, "acme", "guides/faq");
  await deletePage(alice, "acme", "guides");

  expect(await listPages(alice, "acme", "")).toHaveLength(0);

  const listed = await trash(aliceCookie);

  expect(listed).toMatchObject({
    body: {
      pages: [
        { descendants: 1, kind: "folder", path: "guides" },
        { descendants: 0, kind: "page", path: "guides/faq" },
      ],
    },
  });

  await putPage(alice, { ...target, path: "guides/setup" }, { body: "new" });

  const folder = await db<{ id: string }[]>`
    select id from wiki_pages where path = 'guides' and deleted_at is not null
  `;

  const folderId = folder[0]?.id ?? "";

  const restored = await callApi(
    restorePageRoute,
    aliceCookie,
    "POST",
    `/api/v1/wiki/${folderId}/restore`,
    { params: { pageId: folderId } }
  );

  expect(restored).toMatchObject({
    body: { path: "guides-restored" },
    status: 200,
  });
  const live = await listPages(alice, "acme", "");

  expect(live.map(({ path }) => path)).toEqual([
    "guides",
    "guides-restored",
    "guides-restored/setup",
    "guides/setup",
  ]);
  expect(await getPage(alice, "acme", "guides-restored/setup")).toMatchObject({
    body: "old",
  });
  expect(await trash(aliceCookie)).toMatchObject({
    body: { pages: [{ path: "guides/faq" }] },
  });
  expect(
    await callApi(
      restorePageRoute,
      aliceCookie,
      "POST",
      `/api/v1/wiki/${folderId}/restore`,
      { params: { pageId: folderId } }
    )
  ).toMatchObject({ status: 404 });

  const [faq] = await db<{ id: string }[]>`
    select id from wiki_pages where path = 'guides/faq'
  `;

  const faqId = faq?.id ?? "";

  const purge = async (cookie: string) =>
    await callApi(
      purgePageRoute,
      cookie,
      "DELETE",
      `/api/v1/trash/wiki/${faqId}`,
      {
        params: { pageId: faqId },
      }
    );

  expect(await purge(aliceCookie)).toMatchObject({ status: 403 });
  expect(await purge(rootCookie)).toMatchObject({ status: 204 });
  expect(await trash(aliceCookie)).toMatchObject({ body: { pages: [] } });
});

test("the daily purge removes only items older than the trash period", async () => {
  const { alice } = await setup();

  await newIssue(alice, "Old");
  await newIssue(alice, "Fresh");
  await deleteIssue(alice, "ENG-1");
  await deleteIssue(alice, "ENG-2");
  await putPage(alice, { path: "old/page", slug: "acme" }, { body: "x" });
  await deletePage(alice, "acme", "old");
  await db`
    update issues set deleted_at = now() - interval '31 days' where number = 1
  `;
  await db`
    update wiki_pages set deleted_at = now() - interval '31 days'
    where deleted_with is null
  `;

  const published = spyOn(realtime, "publish");

  expect(await purgeTrash()).toEqual({ issues: 1, pages: 1 });
  expect(published.mock.calls.map(([, event]) => event.entity)).toEqual([
    "issue",
    "wiki",
  ]);

  const [counts] = await db<{ issues: number; pages: number }[]>`
    select (select count(*)::int from issues) as issues,
      (select count(*)::int from wiki_pages) as pages
  `;

  expect(counts).toEqual({ issues: 1, pages: 0 });
});

const statusOf = async (run: Promise<void>) => {
  try {
    await run;

    return 204;
  } catch (error) {
    return error instanceof ApiError ? error.status : 500;
  }
};

test("a restore that commits while a purge waits keeps its issue and page", async () => {
  const { alice, root } = await setup();

  await newIssue(alice, "Back");
  await deleteIssue(alice, "ENG-1");
  await db`update issues set deleted_at = now() - interval '31 days'`;
  await putPage(alice, { path: "kept/child", slug: "acme" }, { body: "x" });
  await deletePage(alice, "acme", "kept");

  const [folder] = await db<{ id: string }[]>`
    select id from wiki_pages where path = 'kept'
  `;

  const folderId = folder?.id ?? "";

  let purge = Promise.resolve({ issues: -1, pages: -1 });
  let purgeOne = Promise.resolve(0);

  await db.begin(async (tx) => {
    await tx`select id from issues for update`;
    await tx`select id from wiki_pages where id = ${folderId} for update`;
    purge = purgeTrash(new Date(Date.now() + 60_000));
    purgeOne = statusOf(purgePage(root, folderId));
    await Bun.sleep(200);
    await tx`update issues set deleted_at = null, deleted_by = null`;
    await tx`
      update wiki_pages set deleted_at = null, deleted_by = null,
        deleted_with = null
    `;
  });

  expect(await purge).toEqual({ issues: 0, pages: 0 });
  expect(await purgeOne).toBe(404);

  const pages = await listPages(alice, "acme", "");

  expect(pages.map(({ path }) => path)).toEqual(["kept", "kept/child"]);
});

test("a page deleted with its folder comes back alone, under a new folder", async () => {
  const { alice } = await setup();
  const target = { slug: "acme" };

  await putPage(alice, { ...target, path: "docs/a" }, { body: "a" });
  await putPage(alice, { ...target, path: "docs/b" }, { body: "b" });
  await deletePage(alice, "acme", "docs");

  const [child] = await db<{ id: string }[]>`
    select id from wiki_pages where path = 'docs/a'
  `;

  await restorePage(alice, child?.id ?? "");

  const live = await listPages(alice, "acme", "");

  expect(live.map(({ kind, path }) => `${kind}:${path}`)).toEqual([
    "folder:docs",
    "page:docs/a",
  ]);

  const trashed = await db<{ path: string }[]>`
    select path from wiki_pages where deleted_at is not null order by path
  `;

  expect(trashed.map(({ path }) => path)).toEqual(["docs", "docs/b"]);
});

test("a full-length path that was taken comes back with a shortened name", async () => {
  const { alice } = await setup();
  const path = `long/${"x".repeat(195)}`;

  await putPage(alice, { path, slug: "acme" }, { body: "old" });
  await deletePage(alice, "acme", path);
  await putPage(alice, { path, slug: "acme" }, { body: "new" });

  const [page] = await db<{ id: string }[]>`
    select id from wiki_pages where deleted_at is not null and kind = 'page'
  `;

  const restored = await restorePage(alice, page?.id ?? "");

  expect(restored.path).toBe(`long/${"x".repeat(186)}-restored`);
  expect(restored.body).toBe("old");
});
