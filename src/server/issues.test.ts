import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Comment, IssueEvent } from "~/lib/api-types";
import { countChecklist } from "~/lib/checklist";
import { newId } from "~/lib/ids";
import { Route as commentRoute } from "~/routes/api/v1/comments/$commentId";
import { Route as activityRoute } from "~/routes/api/v1/issues/$issueKey/activity";
import { Route as commentsRoute } from "~/routes/api/v1/issues/$issueKey/comments";
import { Route as issueRoute } from "~/routes/api/v1/issues/$issueKey/index";
import { Route as restoreRoute } from "~/routes/api/v1/issues/$issueKey/restore";
import { Route as labelRoute } from "~/routes/api/v1/labels/$labelId";
import { Route as countsRoute } from "~/routes/api/v1/projects/$key/issue-counts";
import { Route as projectIssuesRoute } from "~/routes/api/v1/projects/$key/issues";
import { Route as workspaceIssuesRoute } from "~/routes/api/v1/workspaces/$slug/issues";
import { Route as searchRoute } from "~/routes/api/v1/workspaces/$slug/search";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { db } from "~/server/db.server";
import { createLabel } from "~/server/labels.server";
import { addMember, removeMember } from "~/server/members.server";
import { createProject, getProject } from "~/server/projects.server";
import { createToken, revokeToken } from "~/server/tokens.server";
import { createWorkspace } from "~/server/workspaces.server";

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
  jest.useRealTimers();
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

  const eng = await createProject(root, "acme", {
    color: "blue",
    key: "ENG",
    name: "Engineering",
  });

  await createProject(root, "globex", { color: "red", key: "GLX", name: "Gx" });

  const bug = await createLabel(root, "acme", {
    color: "red",
    name: "Regression",
  });

  const foreign = await createLabel(root, "globex", {
    color: "red",
    name: "X",
  });

  const status = (name: string) =>
    eng.statuses.find((candidate) => candidate.name === name)?.id ?? "";

  return {
    alice: await sessionCookieFor(aliceId),
    aliceId,
    bob: await sessionCookieFor(bobId),
    bobId,
    bug,
    foreign,
    root: await sessionCookieFor(rootId),
    rootId,
    status,
  };
};

type Body = Record<
  string,
  boolean | number | string | string[] | null | undefined
>;

const byText = (a: string, b: string) => a.localeCompare(b);

const anyString: unknown = expect.any(String);

const RealtimeEventSchema = v.object({
  entity: v.string(),
  id: v.string(),
  issueId: v.optional(v.string()),
  projectId: v.nullable(v.string()),
});

const dataOf = (chunk: string | null) =>
  v.parse(
    RealtimeEventSchema,
    JSON.parse(chunk?.slice("data: ".length) ?? "null")
  );

const CountsSchema = v.array(
  v.object({ count: v.number(), statusId: v.string() })
);

const IssueSchema = v.looseObject({
  id: v.string(),
  key: v.string(),
  version: v.number(),
});

const postIssue = async (auth: string, body: Body, key = "ENG") =>
  await callApi(
    projectIssuesRoute,
    auth,
    "POST",
    `/api/v1/projects/${key}/issues`,
    { body, params: { key } }
  );

const createIssue = async (auth: string, body: Body, key = "ENG") => {
  const response = await postIssue(auth, body, key);

  return { ...response, issue: v.parse(IssueSchema, response.body) };
};

const issueCall = async (
  auth: string,
  method: string,
  issueKey: string,
  body?: Body
) =>
  await callApi(issueRoute, auth, method, `/api/v1/issues/${issueKey}`, {
    body,
    params: { issueKey },
  });

const listIssues = async (auth: string, query = "", key = "ENG") =>
  await callApi(
    projectIssuesRoute,
    auth,
    "GET",
    `/api/v1/projects/${key}/issues${query}`,
    { params: { key } }
  );

const keysOf = (response: { body: unknown }) =>
  v.parse(v.array(IssueSchema), response.body).map((issue) => issue.key);

const activity = async (auth: string, issueKey: string) => {
  const response = await callApi(
    activityRoute,
    auth,
    "GET",
    `/api/v1/issues/${issueKey}/activity`,
    { params: { issueKey } }
  );

  // SAFETY: the activity endpoint answers with `IssueEvent[]`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The route contract types the body.
  return response.body as IssueEvent[];
};

test("deleting a label removes it from issues with a new version and event", async () => {
  const { alice, bug } = await setup();

  const { issue } = await createIssue(alice, {
    labelIds: [bug.id],
    title: "Labelled",
  });

  const { issue: plain } = await createIssue(alice, { title: "Plain" });

  expect(
    await callApi(labelRoute, alice, "DELETE", `/api/v1/labels/${bug.id}`, {
      params: { labelId: bug.id },
    })
  ).toMatchObject({
    status: 204,
  });
  const labelled = await issueCall(alice, "GET", issue.key);
  const unchanged = await issueCall(alice, "GET", plain.key);
  const events = await activity(alice, issue.key);

  expect(labelled.body).toMatchObject({
    labelIds: [],
    version: issue.version + 1,
  });
  expect(unchanged.body).toMatchObject({ version: plain.version });
  expect(events.at(-1)).toMatchObject({
    fromValue: bug.id,
    kind: "label_removed",
  });
});

test("malformed sort keys are rejected", async () => {
  const { alice } = await setup();
  const { issue } = await createIssue(alice, { title: "Sorted" });

  for (const sortKey of ["a0~", "a 1", "a10", ""]) {
    // oxlint-disable-next-line no-await-in-loop -- Each key is checked on its own.
    const response = await issueCall(alice, "PATCH", issue.key, { sortKey });

    expect(response).toMatchObject({
      body: { error: { code: "invalid_request" } },
      status: 400,
    });
  }
});

test("concurrent creates get distinct sequential keys", async () => {
  const { alice } = await setup();

  const created = await Promise.all(
    Array.from(
      { length: 20 },
      async (_, index) => await createIssue(alice, { title: `Issue ${index}` })
    )
  );

  expect(created.every(({ status }) => status === 201)).toBe(true);
  expect(created.map(({ issue }) => issue.key).toSorted(byText)).toEqual(
    Array.from({ length: 20 }, (_, index) => `ENG-${index + 1}`).toSorted(
      byText
    )
  );
});

test("create returns the canonical issue with defaults and a client id", async () => {
  const { alice, aliceId, bug, status } = await setup();
  const id = newId();

  const { body, status: code } = await createIssue(alice, {
    assigneeId: aliceId,
    description: "- [x] one\n- [ ] two\n```\n- [ ] code\n```",
    id,
    labelIds: [bug.id],
    priority: 2,
    title: "  First  ",
  });

  expect(code).toBe(201);
  expect(body).toMatchObject({
    assigneeId: aliceId,
    checklistDone: 1,
    checklistTotal: 2,
    completedAt: null,
    deletedAt: null,
    id,
    key: "ENG-1",
    labelIds: [bug.id],
    number: 1,
    priority: 2,
    statusId: status("Todo"),
    title: "First",
    version: 1,
  });
  const duplicate = await postIssue(alice, { id, title: "Again" });
  const fetched = await issueCall(alice, "GET", "eng-1");

  expect(duplicate.status).toBe(409);
  expect(fetched.body).toEqual(body);
});

test("a missing issue or project answers 404 naming the key", async () => {
  const { alice } = await setup();

  expect(await issueCall(alice, "GET", "eng-99")).toEqual({
    body: { error: { code: "not_found", message: "Issue ENG-99 not found" } },
    status: 404,
  });
  expect(await listIssues(alice, "", "glx")).toEqual({
    body: { error: { code: "not_found", message: "Project GLX not found" } },
    status: 404,
  });
});

test("references outside the workspace are rejected", async () => {
  const { alice, bobId, foreign } = await setup();
  const glx = await getProject({ userId: bobId }, "GLX");

  const responses = await Promise.all(
    [
      { labelIds: [foreign.id], title: "x" },
      { assigneeId: bobId, title: "x" },
      { statusId: glx.statuses[0]?.id, title: "x" },
    ].map(async (body) => await postIssue(alice, body))
  );

  for (const response of responses) {
    expect(response).toMatchObject({
      body: { error: { code: "invalid_request" } },
      status: 400,
    });
  }

  const { issue } = await createIssue(alice, { title: "Mine" });

  expect(
    await issueCall(alice, "PATCH", issue.key, { labelIds: [foreign.id] })
  ).toMatchObject({ status: 400 });
});

test("two writes with the same base version: one wins, one gets 409 with the current issue", async () => {
  const { alice, root } = await setup();
  const { issue } = await createIssue(alice, { title: "Draft" });

  const [first, second] = await Promise.all([
    issueCall(alice, "PATCH", issue.key, { description: "A", version: 1 }),
    issueCall(root, "PATCH", issue.key, { description: "B", version: 1 }),
  ]);

  const statuses = [first.status, second.status].toSorted((a, b) => a - b);
  const loser = first.status === 409 ? first : second;
  const winner = first.status === 200 ? first : second;

  expect(statuses).toEqual([200, 409]);
  expect(loser.body).toMatchObject({
    error: { code: "conflict", current: winner.body },
  });
  expect(winner.body).toMatchObject({ version: 2 });

  expect(
    await issueCall(alice, "PATCH", issue.key, { priority: 1 })
  ).toMatchObject({ body: { priority: 1, version: 3 }, status: 200 });
  expect(
    await issueCall(alice, "PATCH", issue.key, { priority: 1, version: 1 })
  ).toMatchObject({ status: 409 });
  expect(
    await issueCall(alice, "PATCH", issue.key, { priority: 1 })
  ).toMatchObject({ body: { version: 3 }, status: 200 });
});

test("every change records an event with its actor and token", async () => {
  const { alice, aliceId, bug, status } = await setup();
  const token = await createToken({ userId: aliceId }, { name: "agent" });
  const bearer = `Bearer ${token.token}`;
  const { issue } = await createIssue(bearer, { title: "Track" });

  await issueCall(bearer, "PATCH", issue.key, {
    assigneeId: aliceId,
    labelIds: [bug.id],
    priority: 3,
    statusId: status("Done"),
    title: "Tracked",
  });
  await issueCall(alice, "PATCH", issue.key, { description: "one" });
  await issueCall(alice, "PATCH", issue.key, { description: "two" });
  await issueCall(alice, "PATCH", issue.key, { labelIds: [] });
  await issueCall(alice, "PATCH", issue.key, { sortKey: "a1" });

  const events = await activity(alice, issue.key);

  expect(
    events.map(({ fromValue, kind, toValue, viaApi }) => ({
      fromValue,
      kind,
      toValue,
      viaApi,
    }))
  ).toEqual([
    { fromValue: null, kind: "created", viaApi: true, toValue: null },
    {
      fromValue: "Track",
      kind: "title",
      viaApi: true,
      toValue: "Tracked",
    },
    { fromValue: 0, kind: "priority", viaApi: true, toValue: 3 },
    {
      fromValue: status("Todo"),
      kind: "status",
      viaApi: true,
      toValue: status("Done"),
    },
    { fromValue: null, kind: "assignee", viaApi: true, toValue: aliceId },
    {
      fromValue: null,
      kind: "label_added",
      viaApi: true,
      toValue: bug.id,
    },
    { fromValue: null, kind: "description", viaApi: false, toValue: null },
    {
      fromValue: bug.id,
      kind: "label_removed",
      viaApi: false,
      toValue: null,
    },
  ]);
  expect(events[0]?.actor).toMatchObject({ id: aliceId, username: "alice" });
  const tracked = await issueCall(alice, "GET", issue.key);

  expect(tracked.body).toMatchObject({
    completedAt: anyString,
    description: "two",
    sortKey: "a1",
    version: 6,
  });
  expect(
    await issueCall(alice, "PATCH", issue.key, { statusId: status("Todo") })
  ).toMatchObject({ body: { completedAt: null } });
});

test("label additions and removals from two members keep each other's changes", async () => {
  const { alice, bug, foreign, root, rootId } = await setup();
  const actor = { userId: rootId };

  const ops = await createLabel(actor, "acme", { color: "blue", name: "Ops" });

  const docs = await createLabel(actor, "acme", {
    color: "gray",
    name: "Docs",
  });

  const { issue } = await createIssue(alice, {
    labelIds: [docs.id],
    title: "Labels",
  });

  const responses = await Promise.all([
    issueCall(root, "PATCH", issue.key, { addLabelIds: [bug.id] }),
    issueCall(alice, "PATCH", issue.key, {
      addLabelIds: [ops.id],
      removeLabelIds: [docs.id],
    }),
  ]);

  expect(responses.map(({ status }) => status)).toEqual([200, 200]);

  const read = await issueCall(alice, "GET", issue.key);

  const current = v.parse(
    v.object({ labelIds: v.array(v.string()), version: v.number() }),
    read.body
  );

  expect(current.labelIds.toSorted(byText)).toEqual(
    [bug.id, ops.id].toSorted(byText)
  );

  const events = await activity(alice, issue.key);

  expect(
    events
      .filter(({ kind }) => kind === "label_removed")
      .map(({ fromValue }) => fromValue)
  ).toEqual([docs.id]);

  expect(
    await issueCall(alice, "PATCH", issue.key, { removeLabelIds: [docs.id] })
  ).toMatchObject({ body: { version: current.version }, status: 200 });

  for (const body of [
    { addLabelIds: [foreign.id] },
    { addLabelIds: [bug.id], labelIds: [] },
    { addLabelIds: [ops.id], removeLabelIds: [ops.id] },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Each invalid patch is checked in turn.
    expect(await issueCall(alice, "PATCH", issue.key, body)).toMatchObject({
      body: { error: { code: "invalid_request" } },
      status: 400,
    });
  }
});

test("delete is soft and restore brings the issue back", async () => {
  const { alice } = await setup();
  const { issue } = await createIssue(alice, { title: "Gone" });

  expect(await issueCall(alice, "DELETE", issue.key)).toMatchObject({
    body: { deletedAt: anyString, version: 2 },
    status: 200,
  });
  expect(keysOf(await listIssues(alice))).toEqual([]);
  expect(await issueCall(alice, "DELETE", issue.key)).toMatchObject({
    body: {
      error: {
        code: "deleted",
        current: { deletedAt: anyString, version: 2 },
        message: `${issue.key} is already deleted`,
      },
    },
    status: 409,
  });
  expect(
    await issueCall(alice, "PATCH", issue.key, { title: "Edit" })
  ).toMatchObject({ body: { error: { code: "deleted" } }, status: 409 });

  expect(
    await callApi(
      restoreRoute,
      alice,
      "POST",
      `/api/v1/issues/${issue.key}/restore`,
      { params: { issueKey: issue.key } }
    )
  ).toMatchObject({ body: { deletedAt: null, version: 3 }, status: 200 });
  expect(keysOf(await listIssues(alice))).toEqual([issue.key]);

  const kinds = await activity(alice, issue.key);

  expect(kinds.map(({ kind }) => kind)).toEqual([
    "created",
    "deleted",
    "restored",
  ]);
});

test("lists hold the working set, closed pages and filters", async () => {
  const { alice, aliceId, bug, root, status } = await setup();

  const open = await createIssue(alice, {
    assigneeId: aliceId,
    labelIds: [bug.id],
    priority: 1,
    title: "Crash on login",
  });

  const recent = await createIssue(alice, {
    statusId: status("Done"),
    title: "Recent fix",
  });

  const old = await createIssue(alice, {
    description: "Database migration notes",
    statusId: status("Canceled"),
    title: "Old idea",
  });

  const other = await createIssue(root, { priority: 4, title: "Unassigned" });

  await db`
    update issues set canceled_at = now() - interval '30 days'
    where id = ${old.issue.id}
  `;

  expect(keysOf(await listIssues(alice)).toSorted(byText)).toEqual(
    [open.issue.key, recent.issue.key, other.issue.key].toSorted(byText)
  );
  expect(keysOf(await listIssues(alice, "?closed=true"))).toEqual([
    recent.issue.key,
    old.issue.key,
  ]);
  expect(
    keysOf(await listIssues(alice, "?closed=true&limit=1&offset=1"))
  ).toEqual([old.issue.key]);

  const cases: [string, string[]][] = [
    ["?assignee=me", [open.issue.key]],
    ["?assignee=none&priority=low", [other.issue.key]],
    ["?assignee=alice&assignee=none&priority=urgent", [open.issue.key]],
    ["?label=regression", [open.issue.key]],
    [`?label=${bug.id}`, [open.issue.key]],
    ["?status=done", [recent.issue.key]],
    [`?status=${status("Todo")}`, [open.issue.key, other.issue.key]],
    ["?q=crash", [open.issue.key]],
    [`?q=${open.issue.key.toLowerCase()}`, [open.issue.key]],
    ["?closed=true&q=migrations", [old.issue.key]],
  ];

  const results = await Promise.all(
    cases.map(async ([query]) => [
      query,
      keysOf(await listIssues(alice, query)).toSorted(byText),
    ])
  );

  expect(results).toEqual(
    cases.map(([query, expected]) => [query, expected.toSorted(byText)])
  );

  expect(await listIssues(alice, "?priority=extreme")).toMatchObject({
    status: 400,
  });

  const counts = async (query = "") => {
    const response = await callApi(
      countsRoute,
      alice,
      "GET",
      `/api/v1/projects/ENG/issue-counts${query}`,
      { params: { key: "ENG" } }
    );

    return Object.fromEntries(
      v
        .parse(CountsSchema, response.body)
        .map((row) => [row.statusId, row.count])
    );
  };

  expect(await counts()).toEqual({
    [status("Canceled")]: 1,
    [status("Done")]: 1,
    [status("Todo")]: 2,
  });
  expect(await counts("?q=migrations")).toEqual({ [status("Canceled")]: 1 });
  expect(
    keysOf(
      await callApi(
        workspaceIssuesRoute,
        alice,
        "GET",
        "/api/v1/workspaces/acme/issues?assignee=me",
        { params: { slug: "acme" } }
      )
    )
  ).toEqual([open.issue.key]);
});

const searchFor = async (auth: string, slug: string, query: string) =>
  await callApi(
    searchRoute,
    auth,
    "GET",
    `/api/v1/workspaces/${slug}/search?${query}`,
    { params: { slug } }
  );

test("search finds issues by key, title and text, and wiki pages", async () => {
  const { alice, aliceId, bob } = await setup();

  const first = await createIssue(alice, {
    description: "The scheduler runs nightly jobs",
    title: "Background work",
  });

  await createIssue(alice, { title: "Unrelated" });
  await db`
    insert into wiki_pages (
      id, workspace_id, kind, path, sort_key, title, body_md, updated_by
    )
    select ${Bun.randomUUIDv7()}, id, 'page', 'ops/runbook', 'a0', 'Runbook',
      'How the scheduler restarts', ${aliceId}
    from workspaces where slug = 'acme'
  `;

  expect(await searchFor(alice, "acme", "q=eng-1")).toMatchObject({
    body: { issues: [{ key: first.issue.key }], pages: [] },
  });
  expect(await searchFor(alice, "acme", "q=schedulers")).toMatchObject({
    body: {
      issues: [{ key: first.issue.key }],
      pages: [{ path: "ops/runbook", title: "Runbook" }],
    },
  });
  expect(await searchFor(alice, "acme", "q=back&type=issues")).toMatchObject({
    body: { issues: [{ key: first.issue.key }], pages: [] },
  });
  expect(await searchFor(alice, "acme", "q=")).toMatchObject({ status: 400 });
  expect(await searchFor(bob, "acme", "q=eng-1")).toMatchObject({
    status: 404,
  });
});

test("comments: anyone in the workspace comments, only the author edits or deletes", async () => {
  const { alice, root } = await setup();
  const { issue } = await createIssue(alice, { title: "Discuss" });

  const posted = await callApi(
    commentsRoute,
    alice,
    "POST",
    `/api/v1/issues/${issue.key}/comments`,
    { body: { body: "    indented code\n" }, params: { issueKey: issue.key } }
  );

  // SAFETY: the comments endpoint answers with `Comment`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The route contract types the body.
  const comment = posted.body as Comment;

  expect(posted).toMatchObject({
    body: {
      author: { username: "alice" },
      body: "    indented code\n",
      editedAt: null,
    },
    status: 201,
  });
  expect(
    await callApi(
      commentsRoute,
      alice,
      "POST",
      `/api/v1/issues/${issue.key}/comments`,
      { body: { body: " \n\t" }, params: { issueKey: issue.key } }
    )
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });

  const commentCall = async (auth: string, method: string, body?: Body) =>
    await callApi(
      commentRoute,
      auth,
      method,
      `/api/v1/comments/${comment.id}`,
      {
        body,
        params: { commentId: comment.id },
      }
    );

  expect(await commentCall(root, "PATCH", { body: "Hijack" })).toMatchObject({
    status: 403,
  });
  expect(await commentCall(root, "DELETE")).toMatchObject({ status: 403 });
  expect(
    await commentCall(alice, "PATCH", { body: "Edited", version: 1 })
  ).toMatchObject({
    body: { body: "Edited", editedAt: anyString, version: 2 },
    status: 200,
  });
  expect(
    await commentCall(alice, "PATCH", { body: "Stale tab", version: 1 })
  ).toMatchObject({
    body: {
      error: { code: "conflict", current: { body: "Edited", version: 2 } },
    },
    status: 409,
  });
  expect(await commentCall(alice, "DELETE")).toMatchObject({ status: 204 });
  expect(await commentCall(alice, "DELETE")).toMatchObject({ status: 404 });
  expect(
    await callApi(
      commentsRoute,
      alice,
      "GET",
      `/api/v1/issues/${issue.key}/comments`,
      { params: { issueKey: issue.key } }
    )
  ).toMatchObject({ body: [], status: 200 });
  const kinds = await activity(alice, issue.key);

  expect(kinds.map(({ kind }) => kind)).toEqual([
    "created",
    "comment_created",
    "comment_edited",
    "comment_deleted",
  ]);
});

const commentWrite = async (
  auth: string,
  issueKey: string,
  commentId: string,
  method: string
) =>
  method === "POST"
    ? await callApi(
        commentsRoute,
        auth,
        method,
        `/api/v1/issues/${issueKey}/comments`,
        { body: { body: "New" }, params: { issueKey } }
      )
    : await callApi(
        commentRoute,
        auth,
        method,
        `/api/v1/comments/${commentId}`,
        {
          body: method === "PATCH" ? { body: "Edited", version: 1 } : undefined,
          params: { commentId },
        }
      );

const postComment = async (auth: string, issueKey: string) => {
  const response = await callApi(
    commentsRoute,
    auth,
    "POST",
    `/api/v1/issues/${issueKey}/comments`,
    { body: { body: "Original" }, params: { issueKey } }
  );

  return v.parse(v.object({ id: v.string() }), response.body);
};

test("trashed issues reject all comment writes without changing comments or activity", async () => {
  const { alice, bob, root } = await setup();
  const { issue } = await createIssue(alice, { title: "Trash" });
  const comment = await postComment(alice, issue.key);

  await issueCall(alice, "DELETE", issue.key);
  const before = await activity(alice, issue.key);

  const results = [
    await commentWrite(alice, issue.key, comment.id, "POST"),
    await commentWrite(alice, issue.key, comment.id, "PATCH"),
    await commentWrite(alice, issue.key, comment.id, "DELETE"),
  ];

  expect(results.map(({ status }) => status)).toEqual([409, 409, 409]);

  for (const result of results) {
    expect(result.body).toMatchObject({
      error: {
        code: "deleted",
        current: { deletedAt: anyString, id: issue.id, key: issue.key },
      },
    });
  }

  expect(await activity(alice, issue.key)).toEqual(before);

  const [unchanged] = await db<unknown[]>`
    select body_md as body, deleted_at as "deletedAt", version
    from comments where id = ${comment.id}
  `;

  expect(unchanged).toEqual({ body: "Original", deletedAt: null, version: 1 });
  expect(await commentWrite(bob, issue.key, comment.id, "PATCH")).toMatchObject(
    {
      status: 404,
    }
  );
  expect(
    await commentWrite(root, issue.key, comment.id, "DELETE")
  ).toMatchObject({
    status: 403,
  });

  await callApi(
    restoreRoute,
    alice,
    "POST",
    `/api/v1/issues/${issue.key}/restore`,
    {
      params: { issueKey: issue.key },
    }
  );
  expect(
    await commentWrite(alice, issue.key, comment.id, "PATCH")
  ).toMatchObject({
    body: { body: "Edited", version: 2 },
    status: 200,
  });
});

const waitForIssueLock = async (pid: number) => {
  const deadline = Date.now() + 2000;

  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Wait for the request to reach the locked issue before committing its deletion.
    const waiting = await db<unknown[]>`
      select 1 from pg_stat_activity
      where datname = current_database() and ${pid} = any(pg_blocking_pids(pid))
    `;

    if (waiting.length > 0) {
      return;
    }

    // oxlint-disable-next-line no-await-in-loop -- Polling is bounded by the deadline.
    await Bun.sleep(10);
  }

  throw new Error("Comment write did not wait for the issue lock");
};

test.each(["POST", "PATCH", "DELETE"])(
  "comment %s waits for an in-flight issue deletion",
  async (method) => {
    const { alice } = await setup();
    const { issue } = await createIssue(alice, { title: "Concurrent trash" });
    const comment = await postComment(alice, issue.key);
    const before = await activity(alice, issue.key);
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<null>();

    const deleting = db.begin(async (tx) => {
      await tx`update issues set deleted_at = now() where id = ${issue.id}`;

      const [connection] = await tx<
        { pid: number }[]
      >`select pg_backend_pid() as pid`;

      locked.resolve(connection?.pid ?? 0);
      await release.promise;
    });

    const pid = await locked.promise;
    const writing = commentWrite(alice, issue.key, comment.id, method);

    try {
      await waitForIssueLock(pid);
    } finally {
      release.resolve(null);
      await deleting;
      await writing;
    }

    expect(await writing).toMatchObject({
      body: { error: { code: "deleted" } },
      status: 409,
    });
    expect(await activity(alice, issue.key)).toEqual(before);
  }
);

test("concurrent comment deletes record one deletion", async () => {
  const { alice } = await setup();
  const { issue } = await createIssue(alice, { title: "Concurrent delete" });
  const comment = await postComment(alice, issue.key);

  const results = await Promise.all(
    [1, 2].map(
      async () => await commentWrite(alice, issue.key, comment.id, "DELETE")
    )
  );

  expect(results.map(({ status }) => status).toSorted((a, b) => a - b)).toEqual(
    [204, 404]
  );
  const events = await activity(alice, issue.key);

  expect(events.map(({ kind }) => kind)).toEqual([
    "created",
    "comment_created",
    "comment_deleted",
  ]);
});

test("non-members cannot reach issues, comments, lists or the stream", async () => {
  const { alice, bob } = await setup();
  const { issue } = await createIssue(alice, { title: "Secret" });

  const denied = [
    await issueCall(bob, "GET", issue.key),
    await issueCall(bob, "PATCH", issue.key, { title: "Mine" }),
    await issueCall(bob, "DELETE", issue.key),
    await callApi(
      activityRoute,
      bob,
      "GET",
      `/api/v1/issues/${issue.key}/activity`,
      { params: { issueKey: issue.key } }
    ),
    await callApi(
      commentsRoute,
      bob,
      "POST",
      `/api/v1/issues/${issue.key}/comments`,
      { body: { body: "Hi" }, params: { issueKey: issue.key } }
    ),
    await listIssues(bob),
    await postIssue(bob, { title: "Intruder" }),
    await callApi(
      workspaceIssuesRoute,
      bob,
      "GET",
      "/api/v1/workspaces/acme/issues",
      { params: { slug: "acme" } }
    ),
    await callApi(streamRoute, bob, "GET", "/api/v1/workspaces/acme/stream", {
      params: { slug: "acme" },
    }),
  ];

  for (const response of denied) {
    expect(response).toMatchObject({ status: 404 });
  }

  const visible = await issueCall(alice, "GET", issue.key);

  expect(visible.body).toMatchObject({
    title: "Secret",
  });
});

const openStream = async (auth: string, slug: string) => {
  const controller = new AbortController();

  const response = await callRoute(
    streamRoute,
    appRequest(`/api/v1/workspaces/${slug}/stream`, {
      headers: auth.startsWith("Bearer ")
        ? { authorization: auth }
        : { cookie: auth },
      signal: controller.signal,
    }),
    { slug }
  );

  if (response.body === null) {
    throw new Error("Stream has no body");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

  const next = async () => {
    const { done, value } = await reader.read();

    return done ? null : value;
  };

  return {
    abort: () => {
      controller.abort();
    },
    next,
    response,
  };
};

test("a stream rejects an expected user that differs from the request cookie", async () => {
  const { alice, aliceId, bobId } = await setup();

  const response = await callRoute(
    streamRoute,
    appRequest(`/api/v1/workspaces/acme/stream?userId=${bobId}`, {
      headers: { cookie: alice },
    }),
    { slug: "acme" }
  );

  await response.body?.cancel();
  expect(response.status).toBe(404);

  const accepted = await callRoute(
    streamRoute,
    appRequest(`/api/v1/workspaces/acme/stream?userId=${aliceId}`, {
      headers: { cookie: alice },
    }),
    { slug: "acme" }
  );

  await accepted.body?.cancel();
  expect(accepted.status).toBe(200);
});

test("the stream delivers workspace events and drops removed members", async () => {
  const { alice, bob, root, rootId } = await setup();
  const aliceStream = await openStream(alice, "acme");
  const bobStream = await openStream(bob, "globex");

  expect(aliceStream.response.headers.get("content-type")).toBe(
    "text/event-stream"
  );
  expect(await aliceStream.next()).toBe("retry: 3000\n\n");
  expect(await bobStream.next()).toBe("retry: 3000\n\n");

  const { issue } = await createIssue(root, { title: "Live" });
  const eng = await getProject({ userId: rootId }, "ENG");

  expect(await aliceStream.next()).toBe(
    `data: ${JSON.stringify({ entity: "issue", id: issue.id, projectId: eng.id })}\n\n`
  );

  const pending = bobStream.next();

  await createIssue(bob, { title: "Globex only" }, "GLX");
  expect(dataOf(await pending)).toMatchObject({
    entity: "issue",
  });

  const removal = aliceStream.next();

  await removeMember({ userId: rootId }, "acme", "alice");
  expect(dataOf(await removal)).toMatchObject({
    entity: "member",
  });
  expect(await aliceStream.next()).toBeNull();
  bobStream.abort();
});

const drain = async (stream: {
  next: () => Promise<string | null>;
}): Promise<string[]> => {
  const chunk = await stream.next();

  return chunk === null ? [] : [chunk, ...(await drain(stream))];
};

test("a stream closes once its API token is revoked or its session ends", async () => {
  jest.useFakeTimers();
  const { alice, aliceId, bob } = await setup();
  const agent = await createToken({ userId: aliceId }, { name: "agent" });
  const tokenStream = await openStream(`Bearer ${agent.token}`, "acme");
  const sessionStream = await openStream(alice, "acme");
  const otherStream = await openStream(bob, "globex");

  await revokeToken({ userId: aliceId }, agent.id);
  await db`delete from sessions where user_id = ${aliceId}`;
  jest.advanceTimersByTime(30_000);

  expect(await drain(tokenStream)).toContain(": ping\n\n");
  expect(await drain(sessionStream)).toContain(": ping\n\n");
  expect(await otherStream.next()).toBe("retry: 3000\n\n");
  otherStream.abort();
});

test("checklist counting and browser ids", () => {
  expect(
    countChecklist(
      "- [ ] a\n* [x] b\n1. [X] c\n> - [ ] quoted\n```\n- [x] code\n```\n-[ ] no\n- [] no"
    )
  ).toEqual({ done: 2, total: 3 });
  expect(
    countChecklist(
      "````md\n```\n- [ ] example\n```\n````\n- [x] real\n~~~\n- [ ] x\n~~~~ \n- [ ] y"
    )
  ).toEqual({ done: 1, total: 2 });
  expect(newId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
});
