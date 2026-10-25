import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import path from "node:path";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { branchName } from "~/lib/branch";
import { Route as issueRoute } from "~/routes/api/v1/issues/$issueKey/index";
import { Route as projectIssuesRoute } from "~/routes/api/v1/projects/$key/issues";
import { Route as streamRoute } from "~/routes/api/v1/workspaces/$slug/stream";
import { Route as webhookRoute } from "~/routes/api/webhooks/gitea";
import { db } from "~/server/db.server";
import { createIssue } from "~/server/issues.server";
import { createProject } from "~/server/projects.server";
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

const newIssue = () => ({
  assigneeId: null,
  description: "",
  labelIds: [],
  priority: 0 as const,
  title: "Linked",
});

const setup = async () => {
  const rootId = await createUser("root");
  const root = { userId: rootId };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });
  await createProject(root, "globex", { color: "red", key: "OPS", name: "O" });
  await createIssue(root, "ENG", newIssue());
  await createIssue(root, "OPS", newIssue());

  return { actor: root, root: await sessionCookieFor(rootId) };
};

const fixture = async (name: string) =>
  await Bun.file(
    path.join(import.meta.dir, `../../test/fixtures/gitea/${name}.json`)
  ).text();

const sign = (body: string, secret = "test-webhook-secret") =>
  createHmac("sha256", secret).update(body).digest("hex");

const send = async (
  event: string,
  body: string,
  {
    delivery = Bun.randomUUIDv7(),
    signature = sign(body),
  }: { delivery?: string; signature?: string } = {}
) => {
  const response = await callRoute(
    webhookRoute,
    appRequest("/api/webhooks/gitea", {
      body,
      headers: {
        "content-type": "application/json",
        "x-gitea-delivery": delivery,
        "x-gitea-event": event,
        "x-gitea-signature": signature,
      },
      method: "POST",
    })
  );

  const json: unknown = await response.json();

  return { body: json, status: response.status };
};

const deliver = async (event: string, name: string, delivery?: string) =>
  await send(
    event,
    await fixture(name),
    delivery === undefined ? {} : { delivery }
  );

const IssueSchema = v.looseObject({
  links: v.array(
    v.looseObject({
      externalId: v.string(),
      kind: v.string(),
      state: v.nullable(v.string()),
      url: v.string(),
    })
  ),
  version: v.number(),
});

const linksOf = async (auth: string, issueKey: string) => {
  const response = await callApi(
    issueRoute,
    auth,
    "GET",
    `/api/v1/issues/${issueKey}`,
    { params: { issueKey } }
  );

  const issue = v.parse(IssueSchema, response.body);

  return issue.links.map(({ externalId, kind, state }) => ({
    externalId: kind === "commit" ? externalId.slice(0, 7) : externalId,
    kind,
    state,
  }));
};

const pullRequestState = async (auth: string, key: string) => {
  const response = await callApi(
    projectIssuesRoute,
    auth,
    "GET",
    `/api/v1/projects/${key}/issues`,
    { params: { key } }
  );

  const [issue] = v.parse(
    v.array(v.looseObject({ pullRequestState: v.nullable(v.string()) })),
    response.body
  );

  return issue?.pullRequestState;
};

const deliveries = async () => {
  const rows = await db<
    { error: string | null; event: string; status: string }[]
  >`select event, status, error from webhook_deliveries order by received_at`;

  return [...rows];
};

test("only correctly signed deliveries are processed", async () => {
  await setup();
  const body = await fixture("push-branch");

  expect(
    await send("push", body, { signature: sign(body, "wrong") })
  ).toMatchObject({ body: { error: { code: "unauthorized" } }, status: 401 });
  expect(await send("push", body, { signature: "" })).toMatchObject({
    status: 401,
  });
  expect(
    await send("push", `${body} `, { signature: sign(body) })
  ).toMatchObject({ status: 401 });
  expect(await deliveries()).toEqual([]);

  expect(await send("push", "{", { signature: sign("{") })).toMatchObject({
    status: 400,
  });
  expect(await deliveries()).toMatchObject([
    { event: "push", status: "failed" },
  ]);
});

test("an oversized body is rejected while reading, with or without Content-Length", async () => {
  await setup();
  const megabyte = new Uint8Array(1024 * 1024);
  let sent = 0;

  const response = await callRoute(
    webhookRoute,
    appRequest("/api/webhooks/gitea", {
      body: new ReadableStream({
        pull: (controller) => {
          sent += 1;

          if (sent > 20) {
            controller.close();
          } else {
            controller.enqueue(megabyte);
          }
        },
      }),
      headers: { "x-gitea-delivery": "chunked", "x-gitea-event": "push" },
      method: "POST",
    })
  );

  expect(response.status).toBe(413);
  expect(sent).toBeLessThan(10);

  const declared = await callRoute(
    webhookRoute,
    appRequest("/api/webhooks/gitea", {
      body: "{}",
      headers: { "content-length": String(6 * 1024 * 1024) },
      method: "POST",
    })
  );

  expect(declared.status).toBe(413);
  expect(await deliveries()).toEqual([]);
});

test("a push links the branch and commits by key and repeats are deduplicated", async () => {
  const { root } = await setup();
  const delivery = Bun.randomUUIDv7();

  expect(await deliver("create", "create-branch")).toMatchObject({
    body: { status: "processed" },
  });
  expect(await deliver("push", "push-branch", delivery)).toMatchObject({
    body: { status: "processed" },
    status: 200,
  });
  expect(await deliver("push", "push-branch", delivery)).toMatchObject({
    body: { status: "duplicate" },
  });

  expect(await linksOf(root, "ENG-1")).toEqual([
    { externalId: "eng-1-hook-test", kind: "branch", state: null },
    { externalId: "cc9f299", kind: "commit", state: null },
    { externalId: "9deb1f2", kind: "commit", state: null },
  ]);
  expect(await linksOf(root, "OPS-1")).toEqual([
    { externalId: "9deb1f2", kind: "commit", state: null },
  ]);

  await deliver("delete", "delete-branch");
  expect(await linksOf(root, "ENG-1")).toContainEqual({
    externalId: "eng-1-hook-test",
    kind: "branch",
    state: "deleted",
  });
});

test("a branch named by Copy branch name links its issue", async () => {
  const { root } = await setup();
  const branch = branchName("alice", "ENG-1", "Fix login redirect loop");

  const created = await fixture("create-branch");

  const body = created.replace(
    '"ref": "eng-1-hook-test"',
    `"ref": "${branch}"`
  );

  expect(await send("create", body, { signature: sign(body) })).toMatchObject({
    body: { status: "processed" },
  });
  expect(await linksOf(root, "ENG-1")).toEqual([
    {
      externalId: "alice/ENG-1-fix-login-redirect-loop",
      kind: "branch",
      state: null,
    },
  ]);
});

test("a username shaped like a key does not link that key", async () => {
  const { root } = await setup();

  await createUser("ops-1");

  const created = await fixture("create-branch");

  const body = created.replace(
    '"ref": "eng-1-hook-test"',
    `"ref": "${branchName("ops-1", "ENG-1", "Fix it")}"`
  );

  expect(await send("create", body, { signature: sign(body) })).toMatchObject({
    body: { status: "processed" },
  });
  expect(await linksOf(root, "ENG-1")).toMatchObject([
    { externalId: "ops-1/ENG-1-fix-it", kind: "branch" },
  ]);
  expect(await linksOf(root, "OPS-1")).toEqual([]);
});

test("pull requests link through title, body and head and track their state", async () => {
  const { root } = await setup();

  await deliver("pull_request", "pull-request-opened");
  expect(await pullRequestState(root, "ENG")).toBe("open");
  expect(await pullRequestState(root, "OPS")).toBe("open");

  await deliver("pull_request", "pull-request-draft");
  expect(await pullRequestState(root, "ENG")).toBe("draft");

  await deliver("pull_request", "pull-request-merged");
  await deliver("push", "push-merge");
  expect(await linksOf(root, "ENG-1")).toEqual([
    { externalId: "1", kind: "pull_request", state: "merged" },
    { externalId: "eebf511", kind: "commit", state: null },
    { externalId: "9deb1f2", kind: "commit", state: null },
  ]);

  await deliver("pull_request", "pull-request-closed");
  const opsLinks = await linksOf(root, "OPS-1");

  expect(opsLinks.filter(({ kind }) => kind === "pull_request")).toEqual([
    { externalId: "2", kind: "pull_request", state: "closed" },
    { externalId: "1", kind: "pull_request", state: "merged" },
  ]);
  expect(await pullRequestState(root, "OPS")).toBe("merged");

  const issue = await callApi(issueRoute, root, "GET", "/api/v1/issues/ENG-1", {
    params: { issueKey: "ENG-1" },
  });

  expect(issue.body).toMatchObject({ version: 1 });
  const [pullRequest] = v.parse(IssueSchema, issue.body).links;

  expect(pullRequest).toMatchObject({
    authorLogin: "flint-admin",
    repo: "flint-admin/demo-app",
    title: "Hook test for OPS-1",
  });
  expect(pullRequest?.url).toEndWith("/flint-admin/demo-app/pulls/1");
});

test("an older pull request snapshot delivered late does not undo a newer one", async () => {
  const { root } = await setup();

  await deliver("pull_request", "pull-request-merged");
  await deliver("pull_request", "pull-request-draft");
  await deliver("pull_request", "pull-request-opened");

  const links = await linksOf(root, "ENG-1");

  expect(links.find(({ kind }) => kind === "pull_request")).toEqual({
    externalId: "1",
    kind: "pull_request",
    state: "merged",
  });
  expect(await pullRequestState(root, "OPS")).toBe("merged");
});

test("a late older snapshot neither links nor unlinks issues", async () => {
  const { actor, root } = await setup();

  await createIssue(actor, "ENG", newIssue());
  await deliver("pull_request", "pull-request-merged");

  const opened = await fixture("pull-request-opened");

  await send(
    "pull_request",
    opened.replace('"body": "Closes eng-1."', '"body": "Closes eng-2."')
  );

  expect(await linksOf(root, "ENG-2")).toEqual([]);
  expect(await linksOf(root, "ENG-1")).toEqual([
    { externalId: "1", kind: "pull_request", state: "merged" },
  ]);
});

test("a late older snapshot cannot relink an issue after the newest one named none", async () => {
  const { root } = await setup();
  const opened = await fixture("pull-request-opened");

  await send("pull_request", opened);
  expect(await pullRequestState(root, "ENG")).toBe("open");

  await send(
    "pull_request",
    opened
      .replace('"body": "Closes eng-1."', '"body": "No issue."')
      .replaceAll('"Hook test for OPS-1"', '"Hook test"')
      .replaceAll('"eng-1-hook-test"', '"hook-test"')
      .replace(
        '"updated_at": "2026-10-23T03:33:34Z"',
        '"updated_at": "2026-10-23T03:40:00Z"'
      )
  );
  expect(await linksOf(root, "ENG-1")).toEqual([]);
  expect(await linksOf(root, "OPS-1")).toEqual([]);

  await send("pull_request", opened);
  expect(await linksOf(root, "ENG-1")).toEqual([]);
  expect(await linksOf(root, "OPS-1")).toEqual([]);
});

test("a pull request that stops naming an issue drops only its pull request link", async () => {
  const { actor, root } = await setup();

  await createIssue(actor, "ENG", newIssue());
  await deliver("push", "push-branch");
  await deliver("pull_request", "pull-request-opened");

  const merged = await fixture("pull-request-merged");

  await send(
    "pull_request",
    merged
      .replace('"body": "Closes eng-1."', '"body": "Fixes ENG-2 instead."')
      .replaceAll('"Hook test for OPS-1"', '"Hook test"')
      .replaceAll('"eng-1-hook-test"', '"hook-test"')
  );

  expect(await linksOf(root, "ENG-2")).toEqual([
    { externalId: "1", kind: "pull_request", state: "merged" },
  ]);
  const kinds = await linksOf(root, "ENG-1");

  expect(kinds.map(({ kind }) => kind)).not.toContain("pull_request");
  expect(kinds.map(({ kind }) => kind)).toContain("commit");
  expect(await linksOf(root, "OPS-1")).not.toContainEqual(
    expect.objectContaining({ kind: "pull_request" })
  );
  expect(await pullRequestState(root, "OPS")).toBeNull();
});

test("tags are ignored and truncated pushes are recorded", async () => {
  const { root } = await setup();

  expect(await deliver("push", "push-tag")).toMatchObject({
    body: { status: "ignored" },
  });
  expect(await deliver("create", "create-tag")).toMatchObject({
    body: { status: "ignored" },
  });
  await deliver("push", "push-truncated");

  expect(await deliveries()).toEqual([
    { error: null, event: "push", status: "ignored" },
    { error: null, event: "create", status: "ignored" },
    { error: "2 commits not scanned", event: "push", status: "processed" },
  ]);
  expect(await linksOf(root, "OPS-1")).toContainEqual({
    externalId: "feature/ops-1",
    kind: "branch",
    state: null,
  });
});

const link = async (
  kind: string,
  externalId: string,
  {
    headSha = null,
    state = null,
  }: { headSha?: string | null; state?: string | null } = {}
) => {
  await db`
    insert into git_links (
      id, issue_id, kind, repo_full_name, repo_url, external_id, url, state,
      head_sha, occurred_at
    )
    select ${Bun.randomUUIDv7()}, i.id, ${kind}, 'acme/app',
      'http://gitea.test/acme/app', ${externalId}, 'http://gitea.test/x',
      ${state}, ${headSha}, now()
    from issues i join projects p on p.id = i.project_id
    where p.key = 'ENG' and i.number = 1
  `;
};

const status = async (sha: string, context: string, state: string) => {
  await db`
    insert into commit_statuses (
      repo_full_name, sha, context, state, updated_at, gitea_id
    ) values ('acme/app', ${sha}, ${context}, ${state}, now(), 1)
  `;
};

test("CI state comes from the most relevant PR head, else the latest commit", async () => {
  const { root } = await setup();

  const summary = async () => {
    const response = await callApi(
      projectIssuesRoute,
      root,
      "GET",
      "/api/v1/projects/ENG/issues",
      { params: { key: "ENG" } }
    );

    return v.parse(
      v.array(v.looseObject({ ciState: v.nullable(v.string()) })),
      response.body
    )[0]?.ciState;
  };

  expect(await summary()).toBeNull();

  await link("commit", "c1");
  await status("c1", "build", "success");
  await status("c1", "lint", "pending");
  expect(await summary()).toBe("pending");

  await link("pull_request", "7", { headSha: "h1", state: "open" });
  expect(await summary()).toBeNull();

  await status("h1", "build", "failure");
  await status("h1", "lint", "success");
  expect(await summary()).toBe("failure");

  const response = await callApi(
    issueRoute,
    root,
    "GET",
    "/api/v1/issues/ENG-1",
    {
      params: { issueKey: "ENG-1" },
    }
  );

  expect(response.body).toMatchObject({
    ciState: "failure",
    links: [
      {
        checks: [
          { context: "build", state: "failure" },
          { context: "lint", state: "success" },
        ],
        ciState: "failure",
        headSha: "h1",
        kind: "pull_request",
      },
      {
        checks: [{ context: "build" }, { context: "lint" }],
        ciState: "pending",
        kind: "commit",
      },
    ],
  });
});

const headSha = "c77135705fc42b72941ee548575bb548173e13a2";
const syncedSha = "75acfa0970033866728e7c95abaedcc6b1e48267";

const statusBody = async ({
  id = 1,
  repository,
  sha = headSha,
  state = "pending",
}: {
  id?: number;
  repository?: unknown;
  sha?: string;
  state?: string;
} = {}) => {
  const body = v.parse(
    v.looseObject({ repository: v.unknown() }),
    JSON.parse(await fixture("status-pending"))
  );

  return JSON.stringify({
    ...body,
    id,
    repository: repository ?? body.repository,
    sha,
    state,
  });
};

const ciOf = async (auth: string) => {
  const response = await callApi(
    issueRoute,
    auth,
    "GET",
    "/api/v1/issues/ENG-1",
    { params: { issueKey: "ENG-1" } }
  );

  const issue = v.parse(
    v.looseObject({
      ciState: v.nullable(v.string()),
      links: v.array(
        v.looseObject({
          checks: v.array(v.looseObject({ state: v.string() })),
          headSha: v.nullable(v.string()),
          kind: v.string(),
        })
      ),
    }),
    response.body
  );

  const pr = issue.links.find(({ kind }) => kind === "pull_request");

  return {
    checks: pr?.checks.map(({ state }) => state),
    ciState: issue.ciState,
    headSha: pr?.headSha,
  };
};

test("a status delivered before its pull request shows once the PR links", async () => {
  const { root } = await setup();

  expect(await send("status", await statusBody())).toMatchObject({
    body: { status: "processed" },
  });
  await deliver("pull_request", "pull-request-ci-opened");

  expect(await ciOf(root)).toEqual({
    checks: ["pending"],
    ciState: "pending",
    headSha,
  });

  await send("status", await statusBody({ id: 2, state: "success" }));
  expect(await ciOf(root)).toMatchObject({ ciState: "success" });
});

test("a late older status does not replace a newer one for the same context", async () => {
  const { root } = await setup();

  await deliver("pull_request", "pull-request-ci-opened");
  await send("status", await statusBody({ id: 5, state: "failure" }));
  expect(await send("status", await statusBody({ id: 4 }))).toMatchObject({
    body: { status: "ignored" },
  });

  expect(await ciOf(root)).toMatchObject({ ciState: "failure" });
});

test("a pull request shows the status of its current head", async () => {
  const { root } = await setup();

  await deliver("pull_request", "pull-request-ci-opened");
  await send("status", await statusBody({ state: "success" }));
  await deliver("pull_request", "pull-request-synchronized");
  expect(await ciOf(root)).toEqual({
    checks: [],
    ciState: null,
    headSha: syncedSha,
  });

  await deliver("pull_request", "pull-request-ci-opened");
  expect(await ciOf(root)).toMatchObject({ headSha: syncedSha });

  await send(
    "status",
    await statusBody({ id: 2, sha: syncedSha, state: "error" })
  );
  expect(await ciOf(root)).toEqual({
    checks: ["error"],
    ciState: "error",
    headSha: syncedSha,
  });
});

const mention = async (name: string, key: string) => {
  const body = await fixture(name);

  return body.replace('"body": "Closes eng-1."', `"body": "Closes ${key}."`);
};

test("concurrent snapshots of one pull request end on the newest one's issues", async () => {
  const { actor, root } = await setup();

  await createIssue(actor, "ENG", newIssue());
  await createIssue(actor, "ENG", newIssue());

  await Promise.all([
    send("pull_request", await mention("pull-request-opened", "eng-2")),
    send("pull_request", await mention("pull-request-draft", "eng-3")),
    send("pull_request", await mention("pull-request-merged", "eng-1")),
  ]);

  const links = await Promise.all(
    ["ENG-1", "OPS-1", "ENG-2", "ENG-3"].map(
      async (key) => await linksOf(root, key)
    )
  );

  const merged = [{ externalId: "1", kind: "pull_request", state: "merged" }];

  expect(links).toEqual([merged, merged, [], []]);
});

test("of two snapshots from the same second the last processed wins", async () => {
  const { root } = await setup();
  const opened = await fixture("pull-request-ci-opened");

  const later = await fixture("pull-request-synchronized");
  const synced = later.replace("2026-10-24T00:50:29Z", "2026-10-24T00:50:28Z");

  await send("pull_request", opened);
  await send("pull_request", synced);
  expect(await ciOf(root)).toMatchObject({ headSha: syncedSha });

  await send("pull_request", opened);
  expect(await ciOf(root)).toMatchObject({ headSha });
});

test("a status for a linked pull request head publishes the issue after it commits", async () => {
  const { root } = await setup();
  const controller = new AbortController();

  const response = await callRoute(
    streamRoute,
    appRequest("/api/v1/workspaces/acme/stream", {
      headers: { cookie: root },
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
  await deliver("pull_request", "pull-request-ci-opened");

  const linked = await read();

  expect(linked).toContain('"entity":"issue"');
  await send("status", await statusBody({ state: "success" }));
  expect(await read()).toBe(linked);
  expect(await ciOf(root)).toMatchObject({ ciState: "success" });
  controller.abort();
});

const ciSummary = async (auth: string, key: string) => {
  const response = await callApi(
    projectIssuesRoute,
    auth,
    "GET",
    `/api/v1/projects/${key}/issues`,
    { params: { key } }
  );

  return v.parse(
    v.array(v.looseObject({ ciState: v.nullable(v.string()) })),
    response.body
  )[0]?.ciState;
};

test("without a pull request an issue's CI follows its commit's branch head", async () => {
  const { root } = await setup();

  const push = v.parse(
    v.looseObject({
      commits: v.array(v.looseObject({ id: v.string() })),
      repository: v.unknown(),
    }),
    JSON.parse(await fixture("push-branch"))
  );

  const { repository } = push;
  const first = "cc9f299bdf9d1136ee4195ae590d6e3fdf585d71";
  const fix = "f1x0000000000000000000000000000000000000";
  const linked = push.commits.at(-1)?.id ?? "";

  await deliver("push", "push-branch");
  await send(
    "status",
    await statusBody({ repository, sha: linked, state: "failure" })
  );
  await send(
    "status",
    await statusBody({ repository, id: 2, sha: first, state: "success" })
  );
  expect(await ciSummary(root, "OPS")).toBe("success");

  await send(
    "push",
    JSON.stringify({
      ...push,
      after: fix,
      before: first,
      commits: [
        {
          ...push.commits[0],
          id: fix,
          message: "Fix the flaky test",
        },
      ],
      total_commits: 1,
    })
  );
  expect(await ciSummary(root, "OPS")).toBeNull();

  await send(
    "status",
    await statusBody({ repository, id: 3, sha: fix, state: "failure" })
  );
  expect(await ciSummary(root, "OPS")).toBe("failure");

  const response = await callApi(
    issueRoute,
    root,
    "GET",
    "/api/v1/issues/OPS-1",
    { params: { issueKey: "OPS-1" } }
  );

  expect(response.body).toMatchObject({
    links: [
      expect.objectContaining({
        checks: [expect.objectContaining({ state: "failure" })],
        externalId: linked,
        kind: "commit",
      }),
    ],
  });
});
