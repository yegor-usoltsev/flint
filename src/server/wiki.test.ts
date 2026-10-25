import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { newId } from "~/lib/ids";
import { Route as pageByIdRoute } from "~/routes/api/v1/wiki/$pageId/index";
import { Route as moveRoute } from "~/routes/api/v1/wiki/$pageId/move";
import { Route as revisionRoute } from "~/routes/api/v1/wiki/$pageId/revisions/$revision/index";
import { Route as restoreRoute } from "~/routes/api/v1/wiki/$pageId/revisions/$revision/restore";
import { Route as revisionsRoute } from "~/routes/api/v1/wiki/$pageId/revisions/index";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { Route as workspacePageRoute } from "~/routes/api/v1/workspaces/$slug/wiki/$";
import { Route as workspaceWikiRoute } from "~/routes/api/v1/workspaces/$slug/wiki/index";
import { db } from "~/server/db.server";
import { addMember } from "~/server/members.server";
import { createToken } from "~/server/tokens.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  appRequest,
  callApi,
  callRoute,
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

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "member", username: "alice" });
  await addMember(root, "globex", { role: "member", username: "bob" });

  const token = await createToken({ userId: aliceId }, { name: "agent" });

  return {
    alice: await sessionCookieFor(aliceId),
    aliceToken: `Bearer ${token.token}`,
    bob: await sessionCookieFor(bobId),
    root: await sessionCookieFor(rootId),
  };
};

const PageSchema = v.looseObject({
  body: v.string(),
  id: v.string(),
  path: v.string(),
  revision: v.number(),
  sortKey: v.string(),
  title: v.string(),
});

const SummariesSchema = v.array(v.looseObject({ path: v.string() }));

const RevisionsSchema = v.array(
  v.looseObject({
    author: v.looseObject({ username: v.string() }),
    revision: v.number(),
    viaApi: v.boolean(),
  })
);

type Body = Record<string, number | string | undefined>;

const wikiPage = async (
  auth: string,
  method: string,
  path: string,
  body?: Body
) =>
  await callApi(
    workspacePageRoute,
    auth,
    method,
    `/api/v1/workspaces/acme/wiki/${path}`,
    { body, params: { _splat: path, slug: "acme" } }
  );

const listWiki = async (auth: string, query = "") =>
  await callApi(
    workspaceWikiRoute,
    auth,
    "GET",
    `/api/v1/workspaces/acme/wiki${query}`,
    { params: { slug: "acme" } }
  );

const paths = async (auth: string) => {
  const response = await listWiki(auth);

  return v.parse(SummariesSchema, response.body).map(({ path }) => path);
};

const movePage = async (auth: string, pageId: string, body: Body) =>
  await callApi(moveRoute, auth, "POST", `/api/v1/wiki/${pageId}/move`, {
    body,
    params: { pageId },
  });

const putPage = async (auth: string, path: string, body: Body) => {
  const response = await wikiPage(auth, "PUT", path, body);

  return { ...response, page: v.parse(PageSchema, response.body) };
};

const revisions = async (auth: string, pageId: string) =>
  await callApi(
    revisionsRoute,
    auth,
    "GET",
    `/api/v1/wiki/${pageId}/revisions`,
    { params: { pageId } }
  );

const history = async (auth: string, pageId: string) => {
  const response = await revisions(auth, pageId);

  return v.parse(RevisionsSchema, response.body);
};

const revisionNumbers = async (auth: string, pageId: string) => {
  const rows = await history(auth, pageId);

  return rows.map(({ revision }) => revision);
};

const restore = async (auth: string, pageId: string, revision: number) =>
  await callApi(
    restoreRoute,
    auth,
    "POST",
    `/api/v1/wiki/${pageId}/revisions/${revision}/restore`,
    { params: { pageId, revision: String(revision) } }
  );

test("pages live in the workspace wiki, addressed by path", async () => {
  const { alice } = await setup();
  const id = newId();

  const created = await putPage(alice, "Guides/Getting-started", {
    body: "# Hello",
    id,
  });

  expect(created.status).toBe(200);
  expect(created.body).toMatchObject({
    body: "# Hello",
    id,
    kind: "page",
    path: "guides/getting-started",
    revision: 1,
    title: "Getting started",
    updatedBy: { displayName: "alice", username: "alice" },
    workspaceSlug: "acme",
  });

  await putPage(alice, "about", { body: "" });

  expect(await paths(alice)).toEqual([
    "about",
    "guides",
    "guides/getting-started",
  ]);
  expect(await listWiki(alice, "?prefix=Guides/")).toMatchObject({
    body: [{ path: "guides/getting-started" }],
  });
  expect(await wikiPage(alice, "GET", "GUIDES/getting-started")).toEqual({
    body: created.body,
    status: 200,
  });
  expect(
    await callApi(pageByIdRoute, alice, "GET", `/api/v1/wiki/${id}`, {
      params: { pageId: id },
    })
  ).toEqual({ body: created.body, status: 200 });

  const invalid = await Promise.all(
    ["../etc", "a//b", "a/", "-x", "a b"].map(
      async (path) => await wikiPage(alice, "PUT", path, { body: "x" })
    )
  );

  expect(invalid.map(({ status }) => status)).toEqual([
    400, 400, 400, 400, 400,
  ]);
});

test("missing parents become folders; folders hold no body; siblings keep their order", async () => {
  const { alice } = await setup();

  const { page } = await putPage(alice, "handbook/team/onboarding", {
    body: "Welcome",
  });

  expect(await listWiki(alice)).toMatchObject({
    body: [
      { kind: "folder", path: "handbook", revision: 1, title: "Handbook" },
      { kind: "folder", path: "handbook/team", title: "Team" },
      { id: page.id, kind: "page", path: "handbook/team/onboarding" },
    ],
  });
  expect(
    await wikiPage(alice, "PUT", "handbook", { body: "text" })
  ).toMatchObject({ status: 400 });
  expect(
    await wikiPage(alice, "PATCH", "handbook", { append: "text" })
  ).toMatchObject({ status: 400 });
  expect(
    await wikiPage(alice, "PUT", "handbook", { kind: "page" })
  ).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
  expect(
    await wikiPage(alice, "PATCH", "handbook", { title: "Company handbook" })
  ).toMatchObject({ body: { kind: "folder", title: "Company handbook" } });
  expect(
    await wikiPage(alice, "PUT", "archive", { kind: "folder", title: "Old" })
  ).toMatchObject({ body: { body: "", kind: "folder", title: "Old" } });

  const first = await putPage(alice, "handbook/b", { body: "" });
  const second = await putPage(alice, "handbook/a", { body: "" });
  const top = await putPage(alice, "handbook/c", { body: "", sortKey: "Zz" });

  expect(first.page.sortKey < second.page.sortKey).toBe(true);
  expect(top.page.sortKey).toBe("Zz");
});

test("moving a page renames its subtree, keeps ids and rejects bad targets", async () => {
  const { alice, bob } = await setup();
  const { page: guide } = await putPage(alice, "guides/setup", { body: "1" });

  const { page: child } = await putPage(alice, "guides/setup/linux", {
    body: "2",
  });

  const { page: other } = await putPage(alice, "other", { body: "3" });

  expect(
    await movePage(alice, guide.id, { path: "guides/setup/linux/deeper" })
  ).toMatchObject({ status: 400 });
  expect(await movePage(alice, guide.id, { path: "other" })).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(await movePage(alice, guide.id, { path: "guides" })).toMatchObject({
    status: 409,
  });
  expect(await movePage(bob, guide.id, { path: "x" })).toMatchObject({
    status: 404,
  });

  expect(
    await movePage(alice, guide.id, { path: "docs/install" })
  ).toMatchObject({
    body: { id: guide.id, path: "docs/install", revision: 1 },
    status: 200,
  });
  expect(await paths(alice)).toEqual([
    "docs",
    "docs/install",
    "docs/install/linux",
    "guides",
    "other",
  ]);
  expect(await wikiPage(alice, "GET", "docs/install/linux")).toMatchObject({
    body: { body: "2", id: child.id },
  });
  expect(
    await movePage(alice, other.id, { path: "other", sortKey: "a0" })
  ).toMatchObject({ body: { path: "other", sortKey: "a0" } });
  expect(await movePage(alice, other.id, { path: "Bad Path" })).toMatchObject({
    status: 400,
  });
  expect(
    await movePage(alice, guide.id, { path: `deep/${"x".repeat(191)}` })
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });
  expect(await wikiPage(alice, "GET", "docs/install/linux")).toMatchObject({
    status: 200,
  });
});

test("deleting a page deletes its subtree", async () => {
  const { alice } = await setup();

  await putPage(alice, "a/b/c", { body: "x" });
  await putPage(alice, "ab", { body: "y" });

  expect(await wikiPage(alice, "DELETE", "a/b")).toMatchObject({ status: 204 });
  expect(await paths(alice)).toEqual(["a", "ab"]);
});

test("deleting by id deletes the page's current subtree, not what took its old path", async () => {
  const { alice } = await setup();
  const { page: folder } = await putPage(alice, "a", { kind: "folder" });

  await putPage(alice, "a/x", { body: "x" });
  await movePage(alice, folder.id, { path: "moved" });
  await putPage(alice, "a/y", { body: "y" });

  expect(
    await callApi(pageByIdRoute, alice, "DELETE", `/api/v1/wiki/${folder.id}`, {
      params: { pageId: folder.id },
    })
  ).toMatchObject({ status: 204 });
  expect(await paths(alice)).toEqual(["a", "a/y"]);
});

const waitForTreeLock = async (): Promise<void> => {
  const waiting = await db<unknown[]>`
    select 1 from pg_locks
    where locktype = 'advisory' and not granted
      and database = (select oid from pg_database where datname = current_database())
  `;

  if (waiting.length === 0) {
    await Bun.sleep(10);
    await waitForTreeLock();
  }
};

test("a delete queued behind a move deletes the moved page, not the one now at its path", async () => {
  const { alice } = await setup();
  const { page: moved } = await putPage(alice, "a", { body: "x" });

  await putPage(alice, "b", { body: "y" });

  const locked = Promise.withResolvers<null>();
  const release = Promise.withResolvers<null>();

  const mover = db.begin(async (tx) => {
    await tx`
      select pg_advisory_xact_lock(hashtext('flint_wiki'), hashtext(w.id::text))
      from workspaces w where w.slug = 'acme'
    `;
    await tx`update wiki_pages set path = 'moved' where id = ${moved.id}`;
    await tx`update wiki_pages set path = 'a' where path = 'b'`;
    locked.resolve(null);
    await release.promise;
  });

  await locked.promise;

  const deleting = wikiPage(alice, "DELETE", "a");

  await waitForTreeLock();
  release.resolve(null);
  await mover;

  expect(await deleting).toMatchObject({ status: 204 });
  expect(await paths(alice)).toEqual(["a"]);
});

test("a stale base revision gets 409 with the current page; revision 0 only creates", async () => {
  const { alice, root } = await setup();
  const { page } = await putPage(alice, "notes", { body: "v1" });

  const [first, second] = await Promise.all([
    wikiPage(alice, "PUT", "notes", { baseRevision: 1, body: "alice" }),
    wikiPage(root, "PUT", "notes", { baseRevision: 1, body: "root" }),
  ]);

  const loser = first.status === 409 ? first : second;
  const winner = first.status === 200 ? first : second;

  expect([first.status, second.status].toSorted((a, b) => a - b)).toEqual([
    200, 409,
  ]);
  expect(loser.body).toMatchObject({
    error: { code: "conflict", current: winner.body },
  });
  expect(winner.body).toMatchObject({ id: page.id, revision: 2 });

  expect(
    await wikiPage(alice, "PUT", "notes", { baseRevision: 0, body: "new" })
  ).toMatchObject({
    body: { error: { code: "conflict", current: { revision: 2 } } },
    status: 409,
  });
  expect(
    await wikiPage(alice, "PATCH", "missing", {
      append: "x",
      baseRevision: 3,
    })
  ).toMatchObject({ status: 404 });
  expect(
    await wikiPage(alice, "PUT", "other", { body: "x", id: page.id })
  ).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });

  const unchanged = await wikiPage(alice, "PUT", "notes", {
    body: v.parse(PageSchema, winner.body).body,
  });

  expect(unchanged.body).toEqual(winner.body);
});

test("a stale editor of a deleted page cannot overwrite the page recreated at its path", async () => {
  const { alice, root } = await setup();
  const { page: old } = await putPage(alice, "notes", { body: "old" });

  await wikiPage(root, "DELETE", "notes");
  expect(
    await wikiPage(alice, "PUT", "notes", {
      baseRevision: 1,
      body: "stale",
      id: old.id,
    })
  ).toMatchObject({ status: 404 });

  const { page: recreated } = await putPage(root, "notes", { body: "new" });

  const stale = await Promise.all([
    wikiPage(alice, "PUT", "notes", {
      baseRevision: 1,
      body: "stale",
      id: old.id,
    }),
    wikiPage(alice, "PATCH", "notes", {
      baseRevision: 1,
      id: old.id,
      title: "Stale title",
    }),
    wikiPage(alice, "PATCH", "notes", { append: "x", id: old.id }),
  ]);

  for (const response of stale) {
    expect(response).toMatchObject({
      body: { error: { code: "conflict", current: recreated } },
      status: 409,
    });
  }

  expect(
    await wikiPage(alice, "PATCH", "notes", {
      baseRevision: 1,
      id: recreated.id,
      title: "Fresh",
    })
  ).toMatchObject({ body: { revision: 2, title: "Fresh" }, status: 200 });
});

test("append is atomic, creates a missing page and keeps line breaks", async () => {
  const { alice } = await setup();

  const responses = await Promise.all(
    Array.from(
      { length: 10 },
      async (_, index) =>
        await wikiPage(alice, "PATCH", "log", { append: `- entry ${index}` })
    )
  );

  expect(responses.every(({ status }) => status === 200)).toBe(true);

  const log = await wikiPage(alice, "GET", "log");
  const { body } = v.parse(PageSchema, log.body);

  expect(body.split("\n").toSorted()).toEqual(
    Array.from({ length: 10 }, (_, index) => `- entry ${index}`).toSorted()
  );
  expect(
    await wikiPage(alice, "PATCH", "log", { append: "tail\n" })
  ).toMatchObject({ body: { revision: 11 } });
  expect(
    await wikiPage(alice, "PATCH", "log", { append: "after" })
  ).toMatchObject({ body: { body: `${body}\ntail\nafter`, title: "Log" } });
  expect(
    await wikiPage(alice, "PATCH", "log", { title: "Agent log" })
  ).toMatchObject({ body: { revision: 13, title: "Agent log" } });
});

test("revisions merge per author and token during an editing session and restore bumps the revision", async () => {
  const { alice, aliceToken, root } = await setup();
  const { page } = await putPage(alice, "spec", { body: "one" });

  await putPage(alice, "spec", { body: "two" });
  expect(await revisionNumbers(alice, page.id)).toEqual([2]);

  await putPage(root, "spec", { body: "three" });
  await putPage(aliceToken, "spec", { body: "four" });

  expect(await history(alice, page.id)).toMatchObject([
    { author: { username: "alice" }, revision: 4, viaApi: true },
    { author: { username: "root" }, revision: 3, viaApi: false },
    { author: { username: "alice" }, revision: 2, viaApi: false },
  ]);

  await db`
    update wiki_revisions set updated_at = now() - interval '11 minutes'
    where page_id = ${page.id}
  `;
  await putPage(aliceToken, "spec", { body: "five" });
  expect(await revisionNumbers(alice, page.id)).toEqual([5, 4, 3, 2]);

  await db`
    update wiki_revisions set created_at = now() - interval '31 minutes'
    where page_id = ${page.id} and revision = 5
  `;
  await putPage(aliceToken, "spec", { body: "five and a half" });
  expect(await revisionNumbers(alice, page.id)).toEqual([6, 5, 4, 3, 2]);
  await putPage(aliceToken, "spec", { body: "five" });
  expect(await revisionNumbers(alice, page.id)).toEqual([7, 5, 4, 3, 2]);

  const old = await callApi(
    revisionRoute,
    alice,
    "GET",
    `/api/v1/wiki/${page.id}/revisions/2`,
    { params: { pageId: page.id, revision: "2" } }
  );

  expect(old.body).toMatchObject({ body: "two", revision: 2, title: "Spec" });

  const restored = await restore(alice, page.id, 2);

  expect(restored.body).toMatchObject({ body: "two", revision: 8 });
  expect(await revisionNumbers(alice, page.id)).toEqual([8, 7, 5, 4, 3, 2]);
  expect(await restore(alice, page.id, 8)).toEqual(restored);
  expect(await restore(alice, page.id, 1)).toMatchObject({ status: 404 });
});

test("non-members cannot reach another workspace's wiki", async () => {
  const { alice, bob } = await setup();
  const { page } = await putPage(alice, "secret", { body: "classified" });

  const revisionParams = { pageId: page.id, revision: "1" };

  const denied = await Promise.all([
    wikiPage(bob, "GET", "secret"),
    wikiPage(bob, "PUT", "secret", { body: "pwned" }),
    wikiPage(bob, "PATCH", "secret", { append: "pwned" }),
    wikiPage(bob, "PUT", "new", { body: "x" }),
    wikiPage(bob, "DELETE", "secret"),
    callApi(pageByIdRoute, bob, "GET", "/", { params: { pageId: page.id } }),
    movePage(bob, page.id, { path: "stolen" }),
    callApi(workspaceWikiRoute, bob, "GET", "/api/v1/workspaces/acme/wiki", {
      params: { slug: "acme" },
    }),
    callApi(
      workspacePageRoute,
      bob,
      "GET",
      "/api/v1/workspaces/acme/wiki/secret",
      { params: { _splat: "secret", slug: "acme" } }
    ),
    revisions(bob, page.id),
    revisions(bob, "not-a-uuid"),
    callApi(revisionRoute, bob, "GET", "/", { params: revisionParams }),
    callApi(restoreRoute, bob, "POST", "/", { params: revisionParams }),
  ]);

  for (const response of denied) {
    expect(response).toMatchObject({
      body: { error: { code: "not_found" } },
      status: 404,
    });
  }

  expect(await wikiPage(alice, "GET", "secret")).toMatchObject({
    body: { body: "classified", revision: 1 },
  });
});

test("writes and deletes publish wiki events; delete removes the history", async () => {
  const { alice } = await setup();
  const controller = new AbortController();

  const response = await callRoute(
    streamRoute,
    appRequest("/api/v1/workspaces/acme/stream", {
      headers: { cookie: alice },
      signal: controller.signal,
    }),
    { slug: "acme" }
  );

  const reader = response.body
    ?.pipeThrough(new TextDecoderStream())
    .getReader();

  const read = async () => {
    const chunk = await reader?.read();

    return chunk?.value;
  };

  expect(await read()).toBe("retry: 3000\n\n");

  const { page } = await putPage(alice, "doc", { body: "x" });
  const event = `data: ${JSON.stringify({ entity: "wiki", id: page.id, projectId: null })}\n\n`;

  expect(await read()).toBe(event);
  expect(await wikiPage(alice, "DELETE", "doc")).toMatchObject({
    status: 204,
  });
  expect(await read()).toBe(event);
  expect(await wikiPage(alice, "GET", "doc")).toMatchObject({ status: 404 });
  expect(await revisions(alice, page.id)).toMatchObject({ status: 404 });
  controller.abort();
});
