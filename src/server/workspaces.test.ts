import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { Route as labelRoute } from "~/routes/api/v1/labels/$labelId";
import { Route as meRoute } from "~/routes/api/v1/me";
import { Route as projectRoute } from "~/routes/api/v1/projects/$key/index";
import { Route as workspaceRoute } from "~/routes/api/v1/workspaces/$slug/index";
import { Route as labelsRoute } from "~/routes/api/v1/workspaces/$slug/labels";
import { Route as memberRoute } from "~/routes/api/v1/workspaces/$slug/members/$username";
import { Route as membersRoute } from "~/routes/api/v1/workspaces/$slug/members/index";
import { Route as projectsRoute } from "~/routes/api/v1/workspaces/$slug/projects";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { Route as workspacesRoute } from "~/routes/api/v1/workspaces/index";

import {
  appRequest,
  callApi,
  callRoute,
  createUser,
  resetDatabase,
  stubGiteaUsers,
  sessionCookieFor,
} from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  mock.restore();
});

const login = async (username: string) =>
  await sessionCookieFor(await createUser(username));

const createWorkspace = async (cookie: string, slug: string) =>
  await callApi(workspacesRoute, cookie, "POST", "/api/v1/workspaces", {
    body: { name: slug.toUpperCase(), slug },
  });

const addMember = async (
  cookie: string,
  slug: string,
  username: string,
  role = "member"
) =>
  await callApi(
    membersRoute,
    cookie,
    "POST",
    `/api/v1/workspaces/${slug}/members`,
    { body: { role, username }, params: { slug } }
  );

const memberCall = async (
  cookie: string,
  method: string,
  slug: string,
  username: string,
  body?: Record<string, string>
) =>
  await callApi(
    memberRoute,
    cookie,
    method,
    `/api/v1/workspaces/${slug}/members/${username}`,
    { body, params: { slug, username } }
  );

const listOf = async (
  route: Parameters<typeof callApi>[0],
  cookie: string,
  slug: string,
  what: string
) =>
  await callApi(route, cookie, "GET", `/api/v1/workspaces/${slug}/${what}`, {
    params: { slug },
  });

const createProject = async (cookie: string, slug: string, key: string) =>
  await callApi(
    projectsRoute,
    cookie,
    "POST",
    `/api/v1/workspaces/${slug}/projects`,
    { body: { color: "blue", key, name: `Project ${key}` }, params: { slug } }
  );

const projectCall = async (
  cookie: string,
  method: string,
  key: string,
  body?: Record<string, string>
) =>
  await callApi(projectRoute, cookie, method, `/api/v1/projects/${key}`, {
    body,
    params: { key },
  });

const createLabel = async (cookie: string, slug: string, name: string) =>
  await callApi(
    labelsRoute,
    cookie,
    "POST",
    `/api/v1/workspaces/${slug}/labels`,
    { body: { color: "red", name }, params: { slug } }
  );

const labelCall = async (
  cookie: string,
  method: string,
  labelId: string,
  body?: Record<string, string>
) =>
  await callApi(labelRoute, cookie, method, `/api/v1/labels/${labelId}`, {
    body,
    params: { labelId },
  });

const me = async (cookie: string) =>
  await callApi(meRoute, cookie, "GET", "/api/v1/me");

const IdSchema = v.object({ id: v.string() });

const idOf = (response: { body: unknown }) =>
  v.parse(IdSchema, response.body).id;

const setup = async () => {
  const root = await login("root");
  const alice = await login("alice");
  const bob = await login("bob");

  await createWorkspace(root, "acme");
  await createWorkspace(root, "globex");
  await addMember(root, "acme", "alice");
  await addMember(root, "globex", "bob");

  return { alice, bob, root };
};

test("any user creates a workspace and becomes its admin", async () => {
  const root = await login("root");
  const alice = await login("alice");

  expect(await createWorkspace(root, "acme")).toMatchObject({
    body: {
      color: "indigo",
      logoUrl: null,
      name: "ACME",
      role: "admin",
      slug: "acme",
    },
    status: 201,
  });
  expect(await createWorkspace(alice, "acme")).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(await createWorkspace(alice, "alice-co")).toMatchObject({
    body: { role: "admin", slug: "alice-co" },
    status: 201,
  });

  for (const slug of ["Not a slug!", "settings", "api", "doc"]) {
    // oxlint-disable-next-line no-await-in-loop -- Each slug is checked in turn.
    expect(await createWorkspace(alice, slug)).toMatchObject({
      body: { error: { code: "invalid_request" } },
      status: 400,
    });
  }

  expect(await listOf(membersRoute, root, "acme", "members")).toMatchObject({
    body: [
      { displayName: "root", pending: false, role: "admin", username: "root" },
    ],
  });
  expect(await me(alice)).toMatchObject({
    body: { workspaces: [{ slug: "alice-co" }] },
  });
});

const workspaceCall = async (
  cookie: string,
  method: string,
  slug: string,
  body?: Record<string, string>
) =>
  await callApi(workspaceRoute, cookie, method, `/api/v1/workspaces/${slug}`, {
    body,
    params: { slug },
  });

test("admins rename, re-slug, recolor and delete a workspace", async () => {
  const { alice, root } = await setup();

  expect(
    await workspaceCall(alice, "PATCH", "acme", { name: "Nope" })
  ).toMatchObject({ status: 403 });
  expect(
    await workspaceCall(root, "PATCH", "acme", { slug: "globex" })
  ).toMatchObject({ body: { error: { code: "conflict" } }, status: 409 });
  expect(
    await workspaceCall(root, "PATCH", "acme", { slug: "status" })
  ).toMatchObject({ status: 400 });
  expect(
    await workspaceCall(root, "PATCH", "acme", {
      color: "teal",
      name: "Acme Inc",
      slug: "acme-inc",
    })
  ).toMatchObject({
    body: { color: "teal", name: "Acme Inc", role: "admin", slug: "acme-inc" },
    status: 200,
  });
  expect(await workspaceCall(alice, "GET", "acme")).toMatchObject({
    status: 404,
  });
  expect(await workspaceCall(alice, "DELETE", "acme-inc")).toMatchObject({
    status: 403,
  });

  await createProject(root, "acme-inc", "ENG");

  expect(await workspaceCall(root, "DELETE", "acme-inc")).toMatchObject({
    status: 204,
  });
  expect(await projectCall(root, "GET", "ENG")).toMatchObject({ status: 404 });
  expect(await me(alice)).toMatchObject({ body: { workspaces: [] } });
});

test("adding an unknown username keeps an invite until the first login", async () => {
  const { alice, root } = await setup();

  expect(await addMember(root, "acme", "@Dave", "admin")).toMatchObject({
    body: { pending: true, role: "admin", userId: null, username: "Dave" },
    status: 201,
  });
  expect(await addMember(root, "acme", "dave")).toMatchObject({ status: 409 });
  expect(await addMember(root, "acme", "ALICE")).toMatchObject({ status: 409 });
  expect(
    await memberCall(root, "PATCH", "acme", "dave", { role: "member" })
  ).toMatchObject({ body: { pending: true, role: "member" }, status: 200 });

  const dave = await login("dave");

  expect(await me(dave)).toMatchObject({
    body: { workspaces: [{ role: "member", slug: "acme" }] },
  });
  expect(await listOf(membersRoute, alice, "acme", "members")).toMatchObject({
    body: [
      { pending: false, username: "alice" },
      { pending: false, username: "dave" },
      { pending: false, username: "root" },
    ],
  });
});

test("members cannot do admin-only actions", async () => {
  const { alice, root } = await setup();

  await createProject(root, "acme", "ENG");

  expect(await addMember(alice, "acme", "carol")).toMatchObject({
    status: 403,
  });
  expect(
    await memberCall(alice, "PATCH", "acme", "root", { role: "member" })
  ).toMatchObject({ status: 403 });
  expect(await memberCall(alice, "DELETE", "acme", "root")).toMatchObject({
    status: 403,
  });
  expect(await createProject(alice, "acme", "OPS")).toMatchObject({
    body: { error: { code: "forbidden" } },
    status: 403,
  });
  expect(await projectCall(alice, "PATCH", "ENG", { name: "X" })).toMatchObject(
    {
      status: 403,
    }
  );
  expect(await projectCall(alice, "GET", "eng")).toMatchObject({
    body: { key: "ENG" },
    status: 200,
  });
  expect(await createLabel(alice, "acme", "Bug")).toMatchObject({
    status: 201,
  });
});

test("non-members cannot read or change another workspace", async () => {
  const { bob, root } = await setup();

  await createProject(root, "acme", "ENG");

  const label = idOf(await createLabel(root, "acme", "Bug"));

  for (const what of ["members", "projects", "labels"] as const) {
    const route = {
      labels: labelsRoute,
      members: membersRoute,
      projects: projectsRoute,
    }[what];

    // oxlint-disable-next-line no-await-in-loop -- Each case is checked in turn.
    expect(await listOf(route, bob, "acme", what)).toMatchObject({
      body: { error: { code: "not_found" } },
      status: 404,
    });
  }

  expect(
    await callApi(workspaceRoute, bob, "GET", "/api/v1/workspaces/acme", {
      params: { slug: "acme" },
    })
  ).toMatchObject({ status: 404 });
  expect(await addMember(bob, "acme", "bob", "admin")).toMatchObject({
    status: 404,
  });
  expect(await memberCall(bob, "DELETE", "acme", "root")).toMatchObject({
    status: 404,
  });
  expect(await createProject(bob, "acme", "OPS")).toMatchObject({
    status: 404,
  });
  expect(await projectCall(bob, "GET", "ENG")).toMatchObject({ status: 404 });
  expect(await projectCall(bob, "PATCH", "ENG", { name: "X" })).toMatchObject({
    status: 404,
  });
  expect(await createLabel(bob, "acme", "Spam")).toMatchObject({ status: 404 });
  expect(await labelCall(bob, "PATCH", label, { name: "X" })).toMatchObject({
    status: 404,
  });
  expect(await labelCall(bob, "DELETE", label)).toMatchObject({ status: 404 });
  expect(await labelCall(bob, "DELETE", "not-a-uuid")).toMatchObject({
    status: 404,
  });
  expect(await me(bob)).toMatchObject({
    body: { workspaces: [{ slug: "globex" }] },
  });
});

test("a removed member loses access", async () => {
  const { alice, root } = await setup();

  await createProject(root, "acme", "ENG");

  expect(await memberCall(root, "DELETE", "acme", "alice")).toMatchObject({
    status: 204,
  });
  expect(await projectCall(alice, "GET", "ENG")).toMatchObject({ status: 404 });
  expect(await listOf(labelsRoute, alice, "acme", "labels")).toMatchObject({
    status: 404,
  });
  expect(await me(alice)).toMatchObject({ body: { workspaces: [] } });
  expect(await memberCall(root, "DELETE", "acme", "alice")).toMatchObject({
    status: 404,
  });
});

test("the last admin cannot be demoted or removed", async () => {
  const { alice, root } = await setup();

  expect(
    await memberCall(root, "PATCH", "acme", "root", { role: "member" })
  ).toMatchObject({ body: { error: { code: "last_admin" } }, status: 409 });
  expect(await memberCall(root, "DELETE", "acme", "root")).toMatchObject({
    status: 409,
  });
  expect(
    await memberCall(root, "PATCH", "acme", "alice", { role: "admin" })
  ).toMatchObject({ body: { role: "admin", username: "alice" }, status: 200 });
  expect(
    await memberCall(alice, "PATCH", "acme", "root", { role: "member" })
  ).toMatchObject({ body: { role: "member" }, status: 200 });
  expect(await memberCall(alice, "DELETE", "acme", "alice")).toMatchObject({
    status: 409,
  });
});

test("members can leave a workspace", async () => {
  const { alice } = await setup();

  expect(await memberCall(alice, "DELETE", "acme", "alice")).toMatchObject({
    status: 204,
  });
  expect(await me(alice)).toMatchObject({ body: { workspaces: [] } });
});

test("projects get an instance-unique key and the default statuses", async () => {
  const { bob, root } = await setup();

  const created = await createProject(root, "acme", "eng");

  expect(created).toMatchObject({
    body: { color: "blue", icon: "box", key: "ENG", workspaceSlug: "acme" },
    status: 201,
  });
  expect(await projectCall(root, "GET", "ENG")).toMatchObject({
    body: {
      statuses: [
        { category: "backlog", name: "Backlog", position: 0 },
        { category: "unstarted", name: "Todo", position: 1 },
        { category: "started", name: "In Progress", position: 2 },
        { category: "started", name: "In Review", position: 3 },
        { category: "completed", name: "Done", position: 4 },
        { category: "canceled", name: "Canceled", position: 5 },
      ],
    },
  });
  expect(await createProject(root, "globex", "ENG")).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(await createProject(root, "acme", "1AB")).toMatchObject({
    status: 400,
  });
  expect(await createProject(root, "acme", "TOOLONG")).toMatchObject({
    status: 400,
  });
  expect(
    await projectCall(root, "PATCH", "ENG", {
      color: "green",
      icon: "rocket",
      key: "NEW",
      name: "Core",
    })
  ).toMatchObject({
    body: { color: "green", icon: "rocket", key: "ENG", name: "Core" },
  });
  expect(
    await projectCall(root, "PATCH", "ENG", { icon: "not-an-icon" })
  ).toMatchObject({ status: 400 });
  expect(
    await projectCall(root, "PATCH", "ENG", { color: "plaid" })
  ).toMatchObject({
    status: 400,
  });
  expect(await listOf(projectsRoute, root, "acme", "projects")).toMatchObject({
    body: [{ key: "ENG", name: "Core" }],
  });
  expect(await listOf(projectsRoute, bob, "globex", "projects")).toMatchObject({
    body: [],
  });
});

test("only admins delete a project, and its issues go with it", async () => {
  const { alice, root } = await setup();

  await createProject(root, "acme", "ENG");

  expect(await projectCall(alice, "DELETE", "ENG")).toMatchObject({
    status: 403,
  });
  expect(await projectCall(root, "DELETE", "ENG")).toMatchObject({
    status: 204,
  });
  expect(await projectCall(root, "GET", "ENG")).toMatchObject({ status: 404 });
  expect(await createProject(root, "acme", "ENG")).toMatchObject({
    status: 201,
  });
});

test("labels are renamed, recolored and deleted with unique names", async () => {
  const { alice } = await setup();

  const bug = idOf(await createLabel(alice, "acme", "Bug"));

  await createLabel(alice, "acme", "Feature");

  expect(await createLabel(alice, "acme", "bug")).toMatchObject({
    status: 409,
  });
  expect(
    await labelCall(alice, "PATCH", bug, { name: "FEATURE" })
  ).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(
    await labelCall(alice, "PATCH", bug, { color: "purple", name: "Defect" })
  ).toMatchObject({ body: { color: "purple", id: bug, name: "Defect" } });
  expect(await labelCall(alice, "DELETE", bug)).toMatchObject({ status: 204 });
  expect(await listOf(labelsRoute, alice, "acme", "labels")).toMatchObject({
    body: [{ name: "Feature" }],
  });
});

test("an instance admin keeps admin rights with an explicit member row", async () => {
  const { alice, root } = await setup();

  await memberCall(root, "PATCH", "acme", "alice", { role: "admin" });
  expect(
    await memberCall(alice, "PATCH", "acme", "root", { role: "member" })
  ).toMatchObject({ body: { role: "member" }, status: 200 });
  expect(await createProject(root, "acme", "OPS")).toMatchObject({
    status: 201,
  });
  expect(await me(root)).toMatchObject({
    body: { workspaces: [{ role: "admin", slug: "acme" }, { slug: "globex" }] },
  });
});

test("withdrawing or re-roling an invite during its first login is serialized", async () => {
  const { root } = await setup();
  const names = Array.from({ length: 8 }, (_, index) => `guest${index}`);

  await Promise.all(
    names.map(async (name) => await addMember(root, "acme", name, "admin"))
  );
  await Promise.all(
    names.flatMap((name, index) => [
      createUser(name),
      index % 2 === 0
        ? memberCall(root, "DELETE", "acme", name)
        : memberCall(root, "PATCH", "acme", name, { role: "member" }),
    ])
  );

  const members = await listOf(membersRoute, root, "acme", "members");

  expect(
    v
      .parse(
        v.array(v.object({ role: v.string(), username: v.string() })),
        members.body
      )
      .filter(({ username }) => username.startsWith("guest"))
      .map(({ role, username }) => `${username}:${role}`)
      .toSorted((a, b) => a.localeCompare(b))
  ).toEqual([
    "guest1:member",
    "guest3:member",
    "guest5:member",
    "guest7:member",
  ]);
});

test("adding a member matches the username without asking Gitea", async () => {
  const { root } = await setup();
  const spy = stubGiteaUsers();

  await createUser("carol");

  expect(await addMember(root, "acme", "Carol")).toMatchObject({
    body: { pending: false, username: "carol" },
    status: 201,
  });
  expect(await addMember(root, "acme", "ghost")).toMatchObject({
    body: { pending: true, userId: null, username: "ghost" },
    status: 201,
  });
  expect(spy).not.toHaveBeenCalled();
});

test("a member added to a workspace hears it on a stream of another workspace", async () => {
  const { bob, root } = await setup();
  const controller = new AbortController();

  const response = await callRoute(
    streamRoute,
    appRequest("/api/v1/workspaces/globex/stream", {
      headers: { cookie: bob },
      signal: controller.signal,
    }),
    { slug: "globex" }
  );

  const reader = response.body
    ?.pipeThrough(new TextDecoderStream())
    .getReader();

  const read = async () => {
    const chunk = await reader?.read();

    return chunk?.value;
  };

  expect(await read()).toBe("retry: 3000\n\n");
  expect(await addMember(root, "acme", "bob")).toMatchObject({ status: 201 });
  expect(await read()).toBe(
    `data: ${JSON.stringify({ entity: "member", id: "bob", projectId: null })}\n\n`
  );
  controller.abort();
});
