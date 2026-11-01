import { beforeEach, expect, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Body, Endpoint, Query, ResponseOf } from "~/lib/endpoints";
import type {
  OpenApiBody,
  OpenApiEndpoint,
  OpenApiQuery,
  OpenApiResponse,
} from "~/lib/openapi/endpoints";
import {
  vIssue,
  vIssueConflictError,
  vIssueSummary,
  vNotFoundError,
  vUnauthorizedError,
  vUpdateIssue,
} from "~/lib/openapi/valibot/valibot.gen";
import { Route as issueRoute } from "~/routes/api/v1/issues/$issueKey/index";
import { Route as projectIssuesRoute } from "~/routes/api/v1/projects/$key/issues";
import { createIssue, UpdateIssueSchema } from "~/server/issues.server";
import { createProject } from "~/server/projects.server";
import { createToken } from "~/server/tokens.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  appRequest,
  callApi,
  callRoute,
  createUser,
  resetDatabase,
  stubGiteaUsers,
} from "../../../test/helpers";

type Normal<T> = T extends (infer Item)[]
  ? Normal<Item>[]
  : T extends FormData
    ? FormData
    : T extends object
      ? { [K in keyof T]: Normal<T[K]> }
      : T;

/* oxlint-disable typescript/no-unnecessary-type-parameters -- The strict-equality idiom: TypeScript relates the two inline signatures only when A and B are identical, and an alias would lose that. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
/* oxlint-enable typescript/no-unnecessary-type-parameters */

type Same<A, B> = Exact<Normal<A>, Normal<B>>;

type Without<Value, Key extends PropertyKey> = Value extends object
  ? Omit<Value, Key>
  : Value;

type Streaming = "GET /workspaces/:slug/stream";

type Checked = Exclude<OpenApiEndpoint, Streaming>;

type Drift<E extends Checked> = E extends "GET /projects/:key/issues"
  ? "priority"
  : never;

interface Contract<E extends Checked & Endpoint> {
  body: Same<Body<E>, OpenApiBody<E>>;
  query: Same<Without<Query<E>, Drift<E>>, Without<OpenApiQuery<E>, Drift<E>>>;
  response: Same<ResponseOf<E>, OpenApiResponse<E>>;
}

const matches = { body: true, query: true, response: true } as const;

const contract = {
  "GET /issues/:issueKey": matches,
  "GET /projects/:key/issues": matches,
  "PATCH /issues/:issueKey": matches,
  "POST /issues/:issueKey/attachments": matches,
} satisfies { [E in Checked]: Contract<E> };

const priorityOnTheWire: Same<
  NonNullable<OpenApiQuery<"GET /projects/:key/issues">["priority"]>,
  string[]
> = true;

// @ts-expect-error -- A key optional on one side and missing on the other is drift.
const optionalDrift: Same<{ a?: string }, { a?: string; b?: number }> = true;

test("the hand-written endpoint map matches the OpenAPI slice", () => {
  expect(Object.values(contract)).toEqual(
    Object.values(contract).map(() => matches)
  );
  expect(priorityOnTheWire).toBe(true);
  expect(optionalDrift).toBeTruthy();
});

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

const setup = async () => {
  const aliceId = await createUser("alice");
  const alice = { userId: aliceId };

  await createWorkspace(alice, { name: "Acme", slug: "acme" });
  await createProject(alice, "acme", {
    color: "blue",
    key: "ENG",
    name: "Engineering",
  });

  const issue = await createIssue(alice, "ENG", {
    assigneeId: aliceId,
    description: "",
    labelIds: [],
    priority: 2,
    title: "Contract",
  });

  const { token } = await createToken(alice, { name: "contract" });

  return { auth: `Bearer ${token}`, issue };
};

test("issue responses match the generated schemas", async () => {
  const { auth, issue } = await setup();
  const params = { issueKey: issue.key };
  const path = `/api/v1/issues/${issue.key}`;

  const read = await callApi(issueRoute, auth, "GET", path, { params });

  expect(read.status).toBe(200);
  expect(v.parse(vIssue, read.body).key).toBe(issue.key);

  const unassigned = await callApi(issueRoute, auth, "PATCH", path, {
    body: { assigneeId: null, version: issue.version },
    params,
  });

  expect(unassigned.status).toBe(200);
  expect(v.parse(vIssue, unassigned.body).assigneeId).toBeNull();

  const stale = await callApi(issueRoute, auth, "PATCH", path, {
    body: { title: "Stale", version: issue.version },
    params,
  });

  expect(stale.status).toBe(409);
  expect(v.parse(vIssueConflictError, stale.body).error.current?.version).toBe(
    issue.version + 1
  );

  const list = await callApi(
    projectIssuesRoute,
    auth,
    "GET",
    "/api/v1/projects/ENG/issues?priority=high&closed=false",
    { params: { key: "ENG" } }
  );

  expect(list.status).toBe(200);
  expect(v.parse(v.array(vIssueSummary), list.body)).toHaveLength(1);

  const missing = await callApi(issueRoute, auth, "GET", "/api/v1/issues/X-1", {
    params: { issueKey: "X-1" },
  });

  expect(missing.status).toBe(404);
  expect(v.is(vNotFoundError, missing.body)).toBe(true);

  const anonymous = await callRoute(issueRoute, appRequest(path), params);

  expect(anonymous.status).toBe(401);
  expect(v.is(vUnauthorizedError, await anonymous.json())).toBe(true);

  mock.restore();
});

const longTitle = ` ${"x".repeat(500)} `;

test.each([
  [{ assigneeId: null }, true, true],
  [{ title: "   " }, false, false],
  [{ priority: 5 }, false, false],
  [{ version: 0 }, false, false],
  [{ sortKey: "a0" }, true, true],
  [{ sortKey: "0" }, false, true],
  [{ title: longTitle }, true, false],
])(
  "UpdateIssueSchema and the generated schema on %j",
  (body, server, generated) => {
    expect(v.is(UpdateIssueSchema, body)).toBe(server);
    expect(v.is(vUpdateIssue, body)).toBe(generated);
  }
);
