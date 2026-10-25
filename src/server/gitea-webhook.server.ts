import { createHmac, timingSafeEqual } from "node:crypto";

import type { TransactionSQL } from "bun";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { GitLink } from "~/lib/api-types";
import { errorResponse } from "~/server/api.server";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { log } from "~/server/log.server";
import { publish } from "~/server/realtime.server";

const maxPayloadBytes = 5 * 1024 * 1024;

const RepositorySchema = v.object({
  full_name: v.string(),
  html_url: v.string(),
});

const CommitSchema = v.object({
  author: v.object({ name: v.string(), username: v.optional(v.string(), "") }),
  id: v.string(),
  message: v.string(),
  timestamp: v.string(),
  url: v.string(),
});

const PushSchema = v.object({
  after: v.string(),
  commits: v.nullish(v.array(CommitSchema), []),
  pusher: v.nullish(v.object({ login: v.string() })),
  ref: v.string(),
  repository: RepositorySchema,
  total_commits: v.optional(v.number(), 0),
});

const RefSchema = v.object({
  ref: v.string(),
  ref_type: v.string(),
  repository: RepositorySchema,
  sender: v.nullish(v.object({ login: v.string() })),
});

const PullRequestSchema = v.object({
  number: v.number(),
  pull_request: v.object({
    body: v.nullish(v.string(), ""),
    draft: v.optional(v.boolean(), false),
    head: v.object({ ref: v.string(), sha: v.string() }),
    html_url: v.string(),
    merged: v.optional(v.boolean(), false),
    state: v.string(),
    title: v.string(),
    updated_at: v.string(),
    user: v.object({ login: v.string() }),
  }),
  repository: RepositorySchema,
});

const StatusSchema = v.object({
  context: v.string(),
  description: v.nullish(v.string(), ""),
  id: v.number(),
  repository: RepositorySchema,
  sha: v.string(),
  state: v.picklist([
    "error",
    "failure",
    "pending",
    "skipped",
    "success",
    "warning",
  ]),
  target_url: v.nullish(v.string(), ""),
  updated_at: v.string(),
});

type Repository = v.InferOutput<typeof RepositorySchema>;

interface IssueRef {
  id: string;
  key: string;
  projectId: string;
  workspaceId: string;
}

interface LinkInput {
  authorLogin: string | null;
  externalId: string;
  headSha?: string | null;
  kind: GitLink["kind"];
  occurredAt: string;
  ref?: string | null;
  state: GitLink["state"];
  title: string;
  url: string;
}

interface Outcome {
  issues: IssueRef[];
  note: string | null;
  status: "ignored" | "processed";
}

const ignored: Outcome = { issues: [], note: null, status: "ignored" };

const keyMatcher = async (tx: TransactionSQL) => {
  const projects = await tx<{ key: string }[]>`select key from projects`;

  const pattern = new RegExp(
    `(?<![a-z0-9])(${projects.map(({ key }) => key).join("|")})-(\\d{1,9})(?![a-z0-9])`,
    "giu"
  );

  return (text: string) =>
    projects.length === 0
      ? []
      : [...text.matchAll(pattern)].map(
          ([, key = "", number = ""]) =>
            `${key.toUpperCase()}-${Number(number)}`
        );
};

const ownerStripper = async (tx: TransactionSQL) => {
  const users = await tx<{ username: string }[]>`
    select lower(username) as username from users
  `;

  const usernames = new Set(users.map(({ username }) => username));

  return (ref: string) => {
    const [owner = "", ...rest] = ref.split("/");

    return rest.length > 0 && usernames.has(owner.toLowerCase())
      ? rest.join("/")
      : ref;
  };
};

const linkIssues = async (
  tx: TransactionSQL,
  repo: Repository,
  items: { link: LinkInput; refs: string[]; texts: string[] }[]
) => {
  const [match, stripOwner] = await Promise.all([
    keyMatcher(tx),
    ownerStripper(tx),
  ]);

  const keyed = items.map(({ link, refs, texts }) => ({
    keys: new Set([...texts, ...refs.map(stripOwner)].flatMap(match)),
    link,
  }));

  const keys = [...new Set(keyed.flatMap((item) => [...item.keys]))];

  if (keys.length === 0) {
    return [];
  }

  const issues = await tx<IssueRef[]>`
    select i.id, p.key || '-' || i.number as key,
      i.project_id as "projectId", p.workspace_id as "workspaceId"
    from issues i join projects p on p.id = i.project_id
    where p.key || '-' || i.number = any(${tx.array(keys, "text")})
  `;

  const rows = keyed.flatMap(({ keys: itemKeys, link }) =>
    issues.flatMap((issue) =>
      itemKeys.has(issue.key)
        ? [
            {
              author_login: link.authorLogin,
              external_id: link.externalId,
              head_sha: link.headSha ?? null,
              id: Bun.randomUUIDv7(),
              issue_id: issue.id,
              kind: link.kind,
              occurred_at: link.occurredAt,
              ref: link.ref ?? null,
              repo_full_name: repo.full_name,
              repo_url: repo.html_url,
              state: link.state,
              title: link.title,
              url: link.url,
            },
          ]
        : []
    )
  );

  if (rows.length === 0) {
    return [];
  }

  await tx`
    insert into git_links ${tx(rows)}
    on conflict (issue_id, kind, repo_full_name, external_id) do update set
      url = excluded.url, title = excluded.title, state = excluded.state,
      head_sha = case
        when git_links.kind = 'commit' and git_links.ref is distinct from excluded.ref
          then git_links.head_sha
        else coalesce(excluded.head_sha, git_links.head_sha)
      end,
      ref = coalesce(git_links.ref, excluded.ref),
      author_login = coalesce(excluded.author_login, git_links.author_login),
      occurred_at = excluded.occurred_at, updated_at = now()
    where excluded.occurred_at >= git_links.occurred_at
  `;

  const linked = new Set(rows.map((row) => row.issue_id));

  return issues.filter((issue) => linked.has(issue.id));
};

const branchUrl = (repo: Repository, branch: string) =>
  `${repo.html_url}/src/branch/${branch.split("/").map(encodeURIComponent).join("/")}`;

const branchLink = (
  repo: Repository,
  branch: string,
  authorLogin: string | null
): LinkInput => ({
  authorLogin,
  externalId: branch,
  kind: "branch",
  occurredAt: new Date().toISOString(),
  state: null,
  title: branch,
  url: branchUrl(repo, branch),
});

const deleteBranch = async (
  tx: TransactionSQL,
  repo: Repository,
  branch: string
): Promise<Outcome> => {
  const issues = await tx<IssueRef[]>`
    update git_links g set state = 'deleted', updated_at = now()
    from issues i join projects p on p.id = i.project_id
    where g.issue_id = i.id and g.kind = 'branch'
      and g.repo_full_name = ${repo.full_name} and g.external_id = ${branch}
    returning i.id, p.key || '-' || i.number as key,
      i.project_id as "projectId", p.workspace_id as "workspaceId"
  `;

  return { issues, note: null, status: "processed" };
};

const handlePush = async (
  tx: TransactionSQL,
  push: v.InferOutput<typeof PushSchema>
): Promise<Outcome> => {
  if (!push.ref.startsWith("refs/heads/")) {
    return ignored;
  }

  const branch = push.ref.slice("refs/heads/".length);

  if (/^0+$/u.test(push.after)) {
    return await deleteBranch(tx, push.repository, branch);
  }

  const commits = push.commits.map((commit) => ({
    link: {
      authorLogin: commit.author.username || null,
      externalId: commit.id,
      headSha: push.after,
      kind: "commit" as const,
      occurredAt: commit.timestamp,
      ref: branch,
      state: null,
      title: commit.message.split("\n", 1)[0] ?? "",
      url: commit.url,
    },
    refs: [branch],
    texts: [commit.message],
  }));

  const [issues, moved] = await Promise.all([
    linkIssues(tx, push.repository, [
      {
        link: branchLink(push.repository, branch, push.pusher?.login ?? null),
        refs: [branch],
        texts: [],
      },
      ...commits,
    ]),
    tx<IssueRef[]>`
      update git_links g set head_sha = ${push.after}, updated_at = now()
      from issues i join projects p on p.id = i.project_id
      where g.issue_id = i.id and g.kind = 'commit'
        and g.repo_full_name = ${push.repository.full_name} and g.ref = ${branch}
        and g.head_sha is distinct from ${push.after}
      returning i.id, p.key || '-' || i.number as key,
        i.project_id as "projectId", p.workspace_id as "workspaceId"
    `,
  ]);

  const skipped = push.total_commits - push.commits.length;

  return {
    issues: [...issues, ...moved],
    note: skipped > 0 ? `${skipped} commits not scanned` : null,
    status: "processed",
  };
};

const pullRequestState = ({
  draft,
  merged,
  state,
}: v.InferOutput<typeof PullRequestSchema>["pull_request"]) => {
  if (merged) {
    return "merged";
  }

  if (state === "closed") {
    return "closed";
  }

  return draft ? "draft" : "open";
};

const handlePullRequest = async (
  tx: TransactionSQL,
  {
    number,
    pull_request: pr,
    repository,
  }: v.InferOutput<typeof PullRequestSchema>
): Promise<Outcome> => {
  const link: LinkInput = {
    authorLogin: pr.user.login,
    externalId: String(number),
    headSha: pr.head.sha,
    kind: "pull_request",
    occurredAt: pr.updated_at,
    state: pullRequestState(pr),
    title: pr.title,
    url: pr.html_url,
  };

  const newest = await tx<{ number: string }[]>`
    insert into pull_request_snapshots (repo_full_name, number, updated_at)
    values (${repository.full_name}, ${link.externalId}, ${link.occurredAt})
    on conflict (repo_full_name, number) do update
      set updated_at = excluded.updated_at
      where excluded.updated_at >= pull_request_snapshots.updated_at
    returning number
  `;

  if (newest.length === 0) {
    return { issues: [], note: null, status: "processed" };
  }

  const linked = await linkIssues(tx, repository, [
    { link, refs: [pr.head.ref], texts: [pr.title, pr.body] },
  ]);

  const unlinked = await tx<IssueRef[]>`
    delete from git_links g
    using issues i join projects p on p.id = i.project_id
    where g.issue_id = i.id and g.kind = 'pull_request'
      and g.repo_full_name = ${repository.full_name}
      and g.external_id = ${link.externalId}
      and g.issue_id <> all(${tx.array(
        linked.map((issue) => issue.id),
        "uuid"
      )})
    returning i.id, p.key || '-' || i.number as key,
      i.project_id as "projectId", p.workspace_id as "workspaceId"
  `;

  return { issues: [...linked, ...unlinked], note: null, status: "processed" };
};

const handleStatus = async (
  tx: TransactionSQL,
  status: v.InferOutput<typeof StatusSchema>
): Promise<Outcome> => {
  const repo = status.repository.full_name;

  const stored = await tx<{ sha: string }[]>`
    insert into commit_statuses (
      repo_full_name, sha, context, state, target_url, description,
      updated_at, gitea_id
    ) values (
      ${repo}, ${status.sha}, ${status.context}, ${status.state},
      ${status.target_url}, ${status.description}, ${status.updated_at},
      ${status.id}
    )
    on conflict (repo_full_name, sha, context) do update set
      state = excluded.state, target_url = excluded.target_url,
      description = excluded.description, updated_at = excluded.updated_at,
      gitea_id = excluded.gitea_id
    where excluded.gitea_id > commit_statuses.gitea_id
    returning sha
  `;

  if (stored.length === 0) {
    return ignored;
  }

  const issues = await tx<IssueRef[]>`
    select distinct i.id, p.key || '-' || i.number as key,
      i.project_id as "projectId", p.workspace_id as "workspaceId"
    from git_links g
    join issues i on i.id = g.issue_id
    join projects p on p.id = i.project_id
    where g.repo_full_name = ${repo} and (
      (g.kind = 'commit' and ${status.sha} in (g.external_id, g.head_sha))
      or (g.kind = 'pull_request' and g.head_sha = ${status.sha})
    )
  `;

  return { issues, note: null, status: "processed" };
};

const json = <Schema extends v.GenericSchema>(schema: Schema) =>
  v.pipe(v.string(), v.parseJson(), schema);

const lockRepository = async (tx: TransactionSQL, repository: Repository) => {
  await tx`select pg_advisory_xact_lock(hashtextextended('gitea:' || ${repository.full_name}, 0))`;
};

const processEvent = async (
  tx: TransactionSQL,
  event: string,
  payload: string
): Promise<Outcome> => {
  if (event === "push") {
    const push = v.parse(json(PushSchema), payload);
    await lockRepository(tx, push.repository);

    return await handlePush(tx, push);
  }

  if (event === "pull_request") {
    const pullRequest = v.parse(json(PullRequestSchema), payload);
    await lockRepository(tx, pullRequest.repository);

    return await handlePullRequest(tx, pullRequest);
  }

  if (event === "status") {
    const status = v.parse(json(StatusSchema), payload);
    await lockRepository(tx, status.repository);

    return await handleStatus(tx, status);
  }

  if (event !== "create" && event !== "delete") {
    return ignored;
  }

  const ref = v.parse(json(RefSchema), payload);

  if (ref.ref_type !== "branch") {
    return ignored;
  }

  await lockRepository(tx, ref.repository);

  if (event === "delete") {
    return await deleteBranch(tx, ref.repository, ref.ref);
  }

  const issues = await linkIssues(tx, ref.repository, [
    {
      link: branchLink(ref.repository, ref.ref, ref.sender?.login ?? null),
      refs: [ref.ref],
      texts: [],
    },
  ]);

  return { issues, note: null, status: "processed" };
};

const isSigned = (body: Uint8Array, signature: string | null) => {
  const expected = createHmac("sha256", env.GITEA_WEBHOOK_SECRET)
    .update(body)
    .digest();

  const given = Buffer.from(signature ?? "", "hex");

  return given.length === expected.length && timingSafeEqual(given, expected);
};

const readLimited = async (request: Request) => {
  if (Number(request.headers.get("content-length")) > maxPayloadBytes) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;

    if (size > maxPayloadBytes) {
      return null;
    }

    chunks.push(chunk);
  }

  return new Uint8Array(Bun.concatArrayBuffers(chunks));
};

export const receiveGiteaWebhook = async ({
  request,
}: {
  request: Request;
}) => {
  const body = await readLimited(request);

  if (body === null) {
    return errorResponse(413, "too_large", "Payload too large");
  }

  if (!isSigned(body, request.headers.get("x-gitea-signature"))) {
    return errorResponse(401, "unauthorized", "Invalid signature");
  }

  const deliveryId = request.headers.get("x-gitea-delivery") ?? "";
  const event = request.headers.get("x-gitea-event") ?? "";
  const payload = new TextDecoder().decode(body);

  if (deliveryId === "") {
    return errorResponse(400, "invalid_request", "Missing X-Gitea-Delivery");
  }

  try {
    const outcome = await db.begin(async (tx) => {
      const fresh = await tx<{ delivery_id: string }[]>`
        insert into webhook_deliveries (delivery_id, event, status)
        values (${deliveryId}, ${event}, 'processing')
        on conflict (delivery_id) do update set status = 'processing', error = null
        where webhook_deliveries.status = 'failed'
        returning delivery_id
      `;

      if (fresh.length === 0) {
        return null;
      }

      const result = await processEvent(tx, event, payload);

      await tx`
        update webhook_deliveries set status = ${result.status}, error = ${result.note}
        where delivery_id = ${deliveryId}
      `;

      return result;
    });

    if (outcome === null) {
      return Response.json({ status: "duplicate" });
    }

    for (const issue of new Map(
      outcome.issues.map((i) => [i.id, i])
    ).values()) {
      publish(issue.workspaceId, {
        entity: "issue",
        id: issue.id,
        projectId: issue.projectId,
      });
    }

    return Response.json({ status: outcome.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    log.error({ deliveryId, err: error, event }, "Gitea webhook failed");
    await db`
      insert into webhook_deliveries (delivery_id, event, status, error)
      values (${deliveryId}, ${event}, 'failed', ${message})
      on conflict (delivery_id) do update set status = 'failed', error = excluded.error
    `;

    return v.isValiError(error)
      ? errorResponse(400, "invalid_request", v.summarize(error.issues))
      : errorResponse(500, "internal", "Webhook processing failed");
  }
};
