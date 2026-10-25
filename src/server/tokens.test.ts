import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { Route as commentRoute } from "~/routes/api/v1/comments/$commentId";
import { Route as issueRoute } from "~/routes/api/v1/issues/$issueKey/index";
import { Route as meRoute } from "~/routes/api/v1/me/index";
import { Route as tokenRoute } from "~/routes/api/v1/me/tokens/$tokenId";
import { Route as tokensRoute } from "~/routes/api/v1/me/tokens/index";
import { Route as projectRoute } from "~/routes/api/v1/projects/$key/index";
import { Route as pageRoute } from "~/routes/api/v1/wiki/$pageId/index";
import { Route as workspaceRoute } from "~/routes/api/v1/workspaces/$slug/index";
import { Route as searchRoute } from "~/routes/api/v1/workspaces/$slug/search";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { Route as workspacesRoute } from "~/routes/api/v1/workspaces/index";
import { createComment } from "~/server/comments.server";
import { createIssue } from "~/server/issues.server";
import { addMember } from "~/server/members.server";
import { createProject } from "~/server/projects.server";
import { createToken } from "~/server/tokens.server";
import { putPage } from "~/server/wiki.server";
import { createWorkspace, deleteWorkspace } from "~/server/workspaces.server";

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
  const root = { userId: await createUser("root") };
  const alice = { userId: await createUser("alice") };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "member", username: "alice" });
  await addMember(root, "globex", { role: "member", username: "alice" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });
  await createProject(root, "globex", { color: "red", key: "OPS", name: "O" });

  const issue = await createIssue(root, "OPS", {
    assigneeId: null,
    description: "",
    labelIds: [],
    priority: 0,
    title: "Secret",
  });

  const comment = await createComment(root, issue.key, { body: "hidden" });
  const page = await putPage(root, { path: "plans", slug: "globex" }, {});

  const scoped = await createToken(alice, { name: "acme", workspace: "acme" });
  const full = await createToken(alice, { name: "all" });
  const rootScoped = await createToken(root, { name: "r", workspace: "acme" });

  return {
    alice,
    comment,
    full: `Bearer ${full.token}`,
    page,
    root,
    rootScoped: `Bearer ${rootScoped.token}`,
    scoped: `Bearer ${scoped.token}`,
  };
};

test("a workspace token sees only its workspace, even for an instance admin", async () => {
  const { comment, full, page, rootScoped, scoped } = await setup();

  expect(await callApi(meRoute, scoped, "GET", "/api/v1/me")).toMatchObject({
    body: { username: "alice", workspaces: [{ slug: "acme" }] },
  });
  expect(
    await callApi(workspacesRoute, rootScoped, "GET", "/api/v1/workspaces")
  ).toMatchObject({ body: [{ slug: "acme" }] });
  expect(
    await callApi(workspacesRoute, full, "GET", "/api/v1/workspaces")
  ).toMatchObject({ body: [{ slug: "acme" }, { slug: "globex" }] });

  for (const auth of [scoped, rootScoped]) {
    // oxlint-disable-next-line no-await-in-loop -- Each token is checked in turn.
    const denied = await Promise.all([
      callApi(workspaceRoute, auth, "GET", "/", { params: { slug: "globex" } }),
      callApi(projectRoute, auth, "GET", "/", { params: { key: "OPS" } }),
      callApi(issueRoute, auth, "GET", "/", { params: { issueKey: "OPS-1" } }),
      callApi(issueRoute, auth, "PATCH", "/", {
        body: { title: "x" },
        params: { issueKey: "OPS-1" },
      }),
      callApi(commentRoute, auth, "DELETE", "/", {
        params: { commentId: comment.id },
      }),
      callApi(pageRoute, auth, "GET", "/", { params: { pageId: page.id } }),
      callApi(
        searchRoute,
        auth,
        "GET",
        "/api/v1/workspaces/globex/search?q=x",
        {
          params: { slug: "globex" },
        }
      ),
      callApi(streamRoute, auth, "GET", "/", { params: { slug: "globex" } }),
    ]);

    for (const response of denied) {
      expect(response).toMatchObject({
        body: { error: { code: "not_found" } },
        status: 404,
      });
    }
  }

  expect(
    await callApi(projectRoute, scoped, "GET", "/", { params: { key: "ENG" } })
  ).toMatchObject({ status: 200 });
});

const TokensSchema = v.array(v.looseObject({ name: v.string() }));

test("a workspace token creates only tokens for its workspace and no workspaces", async () => {
  const { scoped } = await setup();

  const create = async (body: Record<string, string>) =>
    await callApi(tokensRoute, scoped, "POST", "/api/v1/me/tokens", { body });

  expect(await create({ name: "wide" })).toMatchObject({ status: 403 });
  expect(await create({ name: "other", workspace: "globex" })).toMatchObject({
    status: 404,
  });
  expect(await create({ name: "same", workspace: "acme" })).toMatchObject({
    body: { name: "same", workspaces: [{ name: "Acme", slug: "acme" }] },
    status: 201,
  });
  expect(
    await callApi(workspacesRoute, scoped, "POST", "/api/v1/workspaces", {
      body: { name: "New", slug: "new-co" },
    })
  ).toMatchObject({ status: 403 });

  const listed = await callApi(tokensRoute, scoped, "GET", "/api/v1/me/tokens");

  expect(
    v
      .parse(TokensSchema, listed.body)
      .map(({ name }) => name)
      .toSorted()
  ).toEqual(["acme", "same"]);
});

test("deleting a workspace deletes the tokens restricted to it", async () => {
  const { alice, full, root, scoped } = await setup();

  await deleteWorkspace(root, "acme");

  expect(await callApi(meRoute, scoped, "GET", "/api/v1/me")).toMatchObject({
    status: 401,
  });
  expect(await callApi(meRoute, full, "GET", "/api/v1/me")).toMatchObject({
    body: { workspaces: [{ slug: "globex" }] },
    status: 200,
  });
  expect(
    await callApi(
      tokensRoute,
      await sessionCookieFor(alice.userId),
      "GET",
      "/api/v1/me/tokens"
    )
  ).toMatchObject({ body: [{ name: "all", workspaces: null }] });
});

const NamesSchema = v.array(v.looseObject({ name: v.string() }));

const names = async (auth: string) => {
  const listed = await callApi(tokensRoute, auth, "GET", "/api/v1/me/tokens");

  return v
    .parse(NamesSchema, listed.body)
    .map(({ name }) => name)
    .toSorted();
};

test("a token for several workspaces reaches exactly those", async () => {
  const { alice, root } = await setup();

  await createWorkspace(root, { name: "Initech", slug: "initech" });
  await addMember(root, "initech", { role: "member", username: "alice" });
  await createProject(root, "initech", {
    color: "green",
    key: "INI",
    name: "I",
  });

  const two = await createToken(alice, {
    name: "two",
    workspaces: ["globex", "acme", "acme"],
  });

  const auth = `Bearer ${two.token}`;

  expect(two.workspaces?.map(({ slug }) => slug)).toEqual(["acme", "globex"]);
  expect(await callApi(meRoute, auth, "GET", "/api/v1/me")).toMatchObject({
    body: { workspaces: [{ slug: "acme" }, { slug: "globex" }] },
  });

  const reached = await Promise.all(
    ["ENG", "OPS", "INI"].map(
      async (key) =>
        await callApi(projectRoute, auth, "GET", "/", { params: { key } })
    )
  );

  expect(reached.map(({ status }) => status)).toEqual([200, 200, 404]);
  expect(
    await callApi(
      searchRoute,
      auth,
      "GET",
      "/api/v1/workspaces/initech/search?q=x",
      { params: { slug: "initech" } }
    )
  ).toMatchObject({ status: 404 });
  expect(
    await callApi(streamRoute, auth, "GET", "/", {
      params: { slug: "initech" },
    })
  ).toMatchObject({ status: 404 });

  const create = async (body: { name: string; workspaces?: string[] }) =>
    await callApi(tokensRoute, auth, "POST", "/api/v1/me/tokens", { body });

  expect(await create({ name: "wide" })).toMatchObject({ status: 403 });
  expect(
    await create({ name: "more", workspaces: ["acme", "initech"] })
  ).toMatchObject({ status: 404 });
  expect(await create({ name: "sub", workspaces: ["acme"] })).toMatchObject({
    status: 201,
  });
  expect(
    await callApi(workspacesRoute, auth, "POST", "/api/v1/workspaces", {
      body: { name: "New", slug: "new-co" },
    })
  ).toMatchObject({ status: 403 });

  await createToken(alice, { name: "initech", workspaces: ["initech"] });
  expect(await names(auth)).toEqual(["acme", "sub", "two"]);

  const tokens = await callApi(
    tokensRoute,
    await sessionCookieFor(alice.userId),
    "GET",
    "/api/v1/me/tokens"
  );

  const ids = new Map(
    v
      .parse(
        v.array(v.object({ id: v.string(), name: v.string() })),
        tokens.body
      )
      .map(({ id, name }) => [name, id])
  );

  const revoke = async (name: string) =>
    await callApi(tokenRoute, auth, "DELETE", "/", {
      params: { tokenId: ids.get(name) ?? "" },
    });

  expect(await revoke("all")).toMatchObject({ status: 404 });
  expect(await revoke("initech")).toMatchObject({ status: 404 });
  expect(await revoke("sub")).toMatchObject({ status: 204 });
});

test("a token can only name workspaces its user belongs to", async () => {
  const { alice, root } = await setup();

  await createWorkspace(root, { name: "Hidden", slug: "hidden" });

  expect(
    await callApi(
      tokensRoute,
      await sessionCookieFor(alice.userId),
      "POST",
      "/api/v1/me/tokens",
      { body: { name: "x", workspaces: ["acme", "hidden"] } }
    )
  ).toMatchObject({ body: { error: { code: "not_found" } }, status: 404 });
  expect(
    await callApi(
      tokensRoute,
      await sessionCookieFor(alice.userId),
      "POST",
      "/api/v1/me/tokens",
      { body: { name: "x", workspaces: [] } }
    )
  ).toMatchObject({ status: 400 });
});

test("deleting a workspace drops it from tokens and deletes the emptied ones", async () => {
  const { alice, root, scoped } = await setup();

  const two = await createToken(alice, {
    name: "two",
    workspaces: ["acme", "globex"],
  });

  await deleteWorkspace(root, "acme");

  expect(await callApi(meRoute, scoped, "GET", "/api/v1/me")).toMatchObject({
    status: 401,
  });
  expect(
    await callApi(meRoute, `Bearer ${two.token}`, "GET", "/api/v1/me")
  ).toMatchObject({ body: { workspaces: [{ slug: "globex" }] }, status: 200 });

  await deleteWorkspace(root, "globex");

  expect(
    await callApi(meRoute, `Bearer ${two.token}`, "GET", "/api/v1/me")
  ).toMatchObject({ status: 401 });
});
