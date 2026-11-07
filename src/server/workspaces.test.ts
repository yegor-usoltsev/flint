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
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { signIn } from "~/server/users.server";

import {
  addGiteaUser,
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

test("adding someone who never signed in keeps an invite until the first login", async () => {
  const { alice, root } = await setup();

  addGiteaUser("dave");

  expect(await addMember(root, "acme", "@Dave", "admin")).toMatchObject({
    body: { pending: true, role: "admin", userId: null, username: "dave" },
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
  expect(await createLabel(alice, "acme", "Regression")).toMatchObject({
    status: 201,
  });
});

test("non-members cannot read or change another workspace", async () => {
  const { bob, root } = await setup();

  await createProject(root, "acme", "ENG");

  const label = idOf(await createLabel(root, "acme", "Regression"));

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

test("a new workspace starts with the Bug, Feature and Improvement labels", async () => {
  const { alice } = await setup();

  expect(await listOf(labelsRoute, alice, "acme", "labels")).toMatchObject({
    body: [
      { color: "red", name: "Bug" },
      { color: "purple", name: "Feature" },
      { color: "blue", name: "Improvement" },
    ],
  });
});

test("labels are renamed, recolored and deleted with unique names", async () => {
  const { alice } = await setup();

  const crash = idOf(await createLabel(alice, "acme", "Crash"));

  expect(await createLabel(alice, "acme", "bug")).toMatchObject({
    status: 409,
  });
  expect(
    await labelCall(alice, "PATCH", crash, { name: "FEATURE" })
  ).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(
    await labelCall(alice, "PATCH", crash, { color: "purple", name: "Defect" })
  ).toMatchObject({ body: { color: "purple", id: crash, name: "Defect" } });
  expect(await labelCall(alice, "DELETE", crash)).toMatchObject({
    status: 204,
  });
  expect(await listOf(labelsRoute, alice, "acme", "labels")).toMatchObject({
    body: [{ name: "Bug" }, { name: "Feature" }, { name: "Improvement" }],
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

  for (const name of names) {
    addGiteaUser(name);
  }

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

const signInAs = async (giteaId: string, username: string) =>
  await sessionCookieFor(
    await signIn({ avatarUrl: "", email: "", giteaId, name: "", username })
  );

test("an invite goes to the Gitea account it was made for, whatever names change", async () => {
  const { root } = await setup();
  const daveId = String(addGiteaUser("dave"));

  expect(await addMember(root, "acme", "dave", "admin")).toMatchObject({
    body: { pending: true, username: "dave" },
    status: 201,
  });
  expect(await me(await signInAs("9001", "Dave"))).toMatchObject({
    body: { workspaces: [] },
  });
  expect(await me(await signInAs(daveId, "david"))).toMatchObject({
    body: { workspaces: [{ role: "admin", slug: "acme" }] },
  });
});

const giteaAnswers = (status: number) =>
  stubGiteaUsers().mockImplementation(
    Object.assign(
      async () =>
        await Promise.resolve(Response.json({ message: "no" }, { status })),
      { preconnect: fetch.preconnect }
    )
  );

test("adding a member finds the account through Gitea, or among Flint's accounts when Gitea hides it", async () => {
  const { root } = await setup();
  const erinId = String(addGiteaUser("erin"));

  await signInAs(erinId, "erin-old");
  await signInAs("9002", "erin");

  expect(await addMember(root, "acme", "erin")).toMatchObject({
    body: { pending: false, username: "erin-old" },
    status: 201,
  });
  expect(await addMember(root, "acme", "ghost")).toMatchObject({
    body: { error: { code: "not_found" } },
    status: 404,
  });

  giteaAnswers(403);
  await signInAs("9003", "frank");
  await signInAs("9004", "gil");
  await signInAs("9005", "Gil");

  expect(await addMember(root, "acme", "Frank")).toMatchObject({
    body: { pending: false, username: "frank" },
    status: 201,
  });
  expect(await addMember(root, "acme", "gil")).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(await addMember(root, "acme", "hank")).toMatchObject({
    status: 404,
  });
  expect(await listOf(membersRoute, root, "acme", "members")).toMatchObject({
    body: [
      { username: "alice" },
      { username: "erin-old" },
      { username: "frank" },
      { username: "root" },
    ],
  });
});

test("adding a member fails while Gitea is down instead of matching the name", async () => {
  const { root } = await setup();

  await signInAs("9003", "frank");
  giteaAnswers(500);

  expect(await addMember(root, "acme", "frank")).toMatchObject({
    body: { error: { code: "bad_gateway" } },
    status: 502,
  });
  expect(await listOf(membersRoute, root, "acme", "members")).toMatchObject({
    body: [{ username: "alice" }, { username: "root" }],
  });
});

test("adding a member refuses a name another account still holds in the workspace", async () => {
  const { root } = await setup();

  await signInAs("9010", "carol");
  await addMember(root, "acme", "carol");
  addGiteaUser("carol");

  expect(await addMember(root, "acme", "carol")).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });

  const doraId = String(addGiteaUser("dora"));

  await addMember(root, "acme", "dora");
  await db`update invites set gitea_id = '9011'`;

  const stale = await addMember(root, "acme", "dora");

  expect(stale.status).toBe(409);
  expect(JSON.stringify(stale.body)).toContain("another Gitea account");

  await signInAs(doraId, "dora");

  expect(await addMember(root, "acme", "dora")).toMatchObject({
    body: { error: { code: "conflict" } },
    status: 409,
  });
  expect(await listOf(membersRoute, root, "acme", "members")).toMatchObject({
    body: [
      { username: "alice" },
      { username: "carol" },
      { username: "root" },
      { pending: true, username: "dora" },
    ],
  });
  expect(await memberCall(root, "DELETE", "acme", "dora")).toMatchObject({
    status: 204,
  });
  expect(await addMember(root, "acme", "dora")).toMatchObject({
    body: { pending: false, username: "dora" },
    status: 201,
  });
});

test("an invite needs a name Gitea allows", async () => {
  const { root } = await setup();

  for (const username of ["..", ".", "-x", "_x", ".hidden", "\u212Aelvin"]) {
    // oxlint-disable-next-line no-await-in-loop -- Each name is checked on its own.
    expect(await addMember(root, "acme", username)).toMatchObject({
      status: 400,
    });
  }

  addGiteaUser("x.y_z-1");

  expect(await addMember(root, "acme", "x.y_z-1")).toMatchObject({
    status: 201,
  });
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

  expect(await read()).toBe("retry: 3000\n\nevent: ping\ndata:\n\n");
  expect(await addMember(root, "acme", "bob")).toMatchObject({ status: 201 });
  expect(await read()).toBe(
    `data: ${JSON.stringify({ entity: "member", id: "bob", projectId: null })}\n\n`
  );
  controller.abort();
});

test("a name two members share changes or removes neither until one signs in again", async () => {
  const { root } = await setup();
  const carolId = String(addGiteaUser("carol"));
  const daveId = String(addGiteaUser("dave"));

  const carol = await signInAs(carolId, "carol");

  await addMember(root, "acme", "carol");
  await addMember(root, "acme", "dave");

  const dave = await signInAs(daveId, "Carol");

  expect(await me(dave)).toMatchObject({
    body: { workspaces: [{ role: "member", slug: "acme" }] },
  });

  for (const [cookie, method, body] of [
    [root, "PATCH", { role: "admin" }],
    [root, "DELETE", undefined],
    [dave, "DELETE", undefined],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Each call is checked in turn.
    const response = await memberCall(cookie, method, "acme", "carol", body);

    expect(response).toMatchObject({
      body: { error: { code: "conflict" } },
      status: 409,
    });
    expect(JSON.stringify(response.body)).toContain("@carol");
  }

  for (const cookie of [carol, dave]) {
    // oxlint-disable-next-line no-await-in-loop -- Each member is checked in turn.
    expect(await me(cookie)).toMatchObject({
      body: { workspaces: [{ role: "member", slug: "acme" }] },
    });
  }

  await signInAs(carolId, "carla");

  expect(
    await memberCall(root, "PATCH", "acme", "carol", { role: "admin" })
  ).toMatchObject({ body: { role: "admin", username: "Carol" }, status: 200 });
  expect(await me(dave)).toMatchObject({
    body: { workspaces: [{ role: "admin", slug: "acme" }] },
  });
  expect(await me(carol)).toMatchObject({
    body: { workspaces: [{ role: "member", slug: "acme" }] },
  });
});

test("a member and an invite with one name change or remove neither", async () => {
  const { root } = await setup();
  const erinId = String(addGiteaUser("erin"));

  await addMember(root, "acme", "erin");
  await signInAs("9020", "frank");
  await addMember(root, "acme", "frank");

  const frank = await signInAs("9020", "erin");

  for (const [method, body] of [
    ["PATCH", { role: "admin" }],
    ["DELETE", undefined],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Each call is checked in turn.
    const response = await memberCall(root, method, "acme", "erin", body);

    expect(response).toMatchObject({
      body: { error: { code: "conflict" } },
      status: 409,
    });
    expect(JSON.stringify(response.body)).toContain("pending invite");
  }

  expect(await me(frank)).toMatchObject({
    body: { workspaces: [{ role: "member", slug: "acme" }] },
  });

  await signInAs(erinId, "erna");

  expect(await memberCall(root, "DELETE", "acme", "erin")).toMatchObject({
    status: 204,
  });
  expect(await me(frank)).toMatchObject({ body: { workspaces: [] } });
  expect(await listOf(membersRoute, root, "acme", "members")).toMatchObject({
    body: [
      { username: "alice" },
      { pending: false, role: "member", username: "erna" },
      { username: "root" },
    ],
  });
});

test("past STREAMS_PER_USER a new event stream answers 429 and the open ones stay connected", async () => {
  const { bob } = await setup();
  const saved = env.STREAMS_PER_USER;
  const controllers: AbortController[] = [];

  env.STREAMS_PER_USER = 2;

  const open = async () => {
    const controller = new AbortController();

    controllers.push(controller);

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

    if (response.status === 200) {
      await reader?.read();
    }

    return { controller, reader, status: response.status };
  };

  try {
    const first = await open();
    const second = await open();
    const third = await open();

    expect(third.status).toBe(429);
    expect(
      await Promise.race([
        first.reader?.read().then(() => "closed"),
        Bun.sleep(50).then(() => "open"),
      ])
    ).toBe("open");

    second.controller.abort();
    await second.reader?.cancel();

    const reopened = await open();
    const past = await open();

    expect(reopened.status).toBe(200);
    expect(past.status).toBe(429);
  } finally {
    for (const controller of controllers) {
      controller.abort();
    }

    env.STREAMS_PER_USER = saved;
  }
});

test("an event stream aborted before it opens frees its slot", async () => {
  const { bob } = await setup();
  const saved = env.STREAMS_PER_USER;
  const controllers: AbortController[] = [];

  env.STREAMS_PER_USER = 1;

  const open = async (aborted: boolean) => {
    const controller = new AbortController();

    controllers.push(controller);

    if (aborted) {
      controller.abort();
    }

    const response = await callRoute(
      streamRoute,
      appRequest("/api/v1/workspaces/globex/stream", {
        headers: { cookie: bob },
        signal: controller.signal,
      }),
      { slug: "globex" }
    );

    if (!aborted) {
      await response.body?.cancel();
    }

    return response.status;
  };

  try {
    await open(true);

    expect(await open(false)).toBe(200);
  } finally {
    for (const controller of controllers) {
      controller.abort();
    }

    env.STREAMS_PER_USER = saved;
  }
});
