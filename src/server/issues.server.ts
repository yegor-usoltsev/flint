import type { SQL, TransactionSQL } from "bun";
import { generateKeyBetween } from "fractional-indexing";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type {
  Issue,
  IssueEvent,
  IssueEventKind,
  IssueSummary,
  Role,
  StatusCategory,
  StatusCount,
} from "~/lib/api-types";
import { countChecklist } from "~/lib/checklist";
import {
  notFound,
  requireWorkspace,
  userRef,
  workspaceRole,
} from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { refreshEmbedding } from "~/server/embeddings.server";
import { findProject } from "~/server/projects.server";
import { publish } from "~/server/realtime.server";

const UuidSchema = v.pipe(v.string(), v.uuid());

const TitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.maxLength(500)
);

const DescriptionSchema = v.pipe(v.string(), v.maxLength(200_000));
const PrioritySchema = v.picklist([0, 1, 2, 3, 4]);

const isSortKey = (key: string) => {
  try {
    generateKeyBetween(key, null);

    return true;
  } catch {
    return false;
  }
};

export const SortKeySchema = v.pipe(
  v.string(),
  v.maxLength(100),
  v.regex(/^[0-9A-Za-z]+$/u, "Invalid sort key"),
  v.check(isSortKey, "Invalid sort key")
);

export const CreateIssueSchema = v.object({
  assigneeId: v.optional(v.nullable(UuidSchema), null),
  description: v.optional(DescriptionSchema, ""),
  id: v.optional(UuidSchema),
  labelIds: v.optional(v.array(UuidSchema), []),
  priority: v.optional(PrioritySchema, 0),
  sortKey: v.optional(SortKeySchema),
  statusId: v.optional(UuidSchema),
  title: TitleSchema,
});

export const UpdateIssueSchema = v.object({
  assigneeId: v.optional(v.nullable(UuidSchema)),
  description: v.optional(DescriptionSchema),
  addLabelIds: v.optional(v.array(UuidSchema)),
  labelIds: v.optional(v.array(UuidSchema)),
  priority: v.optional(PrioritySchema),
  removeLabelIds: v.optional(v.array(UuidSchema)),
  sortKey: v.optional(SortKeySchema),
  statusId: v.optional(UuidSchema),
  title: v.optional(TitleSchema),
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

const priorityNames = ["none", "urgent", "high", "medium", "low"];

const ListQuerySchema = v.object({
  assignee: v.array(v.pipe(v.string(), v.trim(), v.toLowerCase())),
  closed: v.optional(v.picklist(["true", "false"]), "false"),
  label: v.array(v.pipe(v.string(), v.trim(), v.toLowerCase())),
  limit: v.optional(
    v.pipe(
      v.string(),
      v.digits(),
      v.transform(Number),
      v.minValue(1),
      v.maxValue(200)
    ),
    "50"
  ),
  offset: v.optional(
    v.pipe(v.string(), v.digits(), v.transform(Number), v.maxValue(1_000_000)),
    "0"
  ),
  priority: v.array(
    v.pipe(
      v.string(),
      v.toLowerCase(),
      v.transform((value) =>
        priorityNames.includes(value)
          ? priorityNames.indexOf(value)
          : Number(value)
      ),
      PrioritySchema
    )
  ),
  q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ""),
  status: v.array(v.pipe(v.string(), v.trim(), v.toLowerCase())),
});

export type IssueQuery = v.InferOutput<typeof ListQuerySchema>;

export const readIssueQuery = (request: Request) => {
  const params = new URL(request.url).searchParams;

  return v.parse(ListQuerySchema, {
    assignee: params.getAll("assignee"),
    closed: params.get("closed") ?? undefined,
    label: params.getAll("label"),
    limit: params.get("limit") ?? undefined,
    offset: params.get("offset") ?? undefined,
    priority: params.getAll("priority"),
    q: params.get("q") ?? undefined,
    status: params.getAll("status"),
  });
};

const linkSha = db`
  case g.kind when 'commit' then g.external_id
    when 'pull_request' then g.head_sha end
`;

const workSha = db`
  case g.kind when 'commit' then coalesce(g.head_sha, g.external_id)
    when 'pull_request' then g.head_sha end
`;

// oxlint-disable-next-line typescript/promise-function-async -- Returns an unexecuted Bun SQL fragment, which is thenable.
const stateAt = (sha: typeof linkSha) => db`
  (
    select s.state from commit_statuses s
    where s.repo_full_name = g.repo_full_name and s.sha = ${sha}
    order by array_position(
      array['error', 'failure', 'warning', 'pending', 'success', 'skipped'],
      s.state
    )
    limit 1
  )
`;

const linkState = stateAt(linkSha);

export const summaryColumns = db`
  i.id, p.key || '-' || i.number as key, i.number,
  i.project_id as "projectId", i.title, i.status_id as "statusId",
  i.priority, i.assignee_id as "assigneeId", i.creator_id as "creatorId",
  array(
    select label_id::text from issue_labels l
    where l.issue_id = i.id order by label_id
  ) as "labelIds",
  i.sort_key as "sortKey", i.checklist_done as "checklistDone",
  i.checklist_total as "checklistTotal", i.completed_at as "completedAt",
  i.canceled_at as "canceledAt", i.created_at as "createdAt",
  i.updated_at as "updatedAt", i.version,
  (
    select g.state from git_links g
    where g.issue_id = i.id and g.kind = 'pull_request'
    order by array_position(array['open', 'draft', 'merged', 'closed'], g.state)
    limit 1
  ) as "pullRequestState",
  (
    select ${stateAt(workSha)} from git_links g
    where g.issue_id = i.id and ${workSha} is not null
    order by g.kind = 'pull_request' desc,
      array_position(array['open', 'draft', 'merged', 'closed'], g.state),
      g.occurred_at desc
    limit 1
  ) as "ciState"
`;

export const selectIssue = async (sql: SQL, id: string) => {
  const [issue] = await sql<Issue[]>`
    select ${summaryColumns}, i.description_md as description,
      i.deleted_at as "deletedAt",
      coalesce((
        select json_agg(json_build_object(
          'id', g.id, 'kind', g.kind, 'repo', g.repo_full_name,
          'repoUrl', g.repo_url, 'externalId', g.external_id, 'url', g.url,
          'title', g.title, 'state', g.state, 'authorLogin', g.author_login,
          'occurredAt', g.occurred_at, 'headSha', g.head_sha,
          'ciState', ${linkState},
          'checks', coalesce((
            select json_agg(json_build_object(
              'context', s.context, 'state', s.state,
              'targetUrl', s.target_url, 'description', s.description,
              'updatedAt', s.updated_at
            ) order by s.context)
            from commit_statuses s
            where s.repo_full_name = g.repo_full_name and s.sha = ${linkSha}
          ), '[]')
        ) order by
          array_position(array['pull_request', 'branch', 'commit'], g.kind),
          g.occurred_at desc, g.id
        )
        from git_links g where g.issue_id = i.id
      ), '[]') as links
    from issues i join projects p on p.id = i.project_id
    where i.id = ${id}
  `;

  if (issue === undefined) {
    throw notFound("Issue");
  }

  return issue;
};

interface IssueRef {
  id: string;
  projectId: string;
  role: Role;
  workspaceId: string;
}

export const keyPattern =
  /^(?<project>[A-Za-z][A-Za-z0-9]{1,4})-(?<number>\d{1,9})$/u;

export const findIssue = async (
  actor: Actor,
  key: string
): Promise<IssueRef> => {
  const match = keyPattern.exec(key)?.groups;

  const [issue] =
    match === undefined
      ? []
      : await db<Omit<IssueRef, "role">[]>`
          select i.id, i.project_id as "projectId",
            p.workspace_id as "workspaceId"
          from issues i join projects p on p.id = i.project_id
          where p.key = ${match["project"]?.toUpperCase()}
            and i.number = ${Number(match["number"])}
        `;

  const role =
    issue === undefined ? null : await workspaceRole(actor, issue.workspaceId);

  if (issue === undefined || role === null) {
    throw notFound(`Issue ${key.toUpperCase()}`);
  }

  return { ...issue, role };
};

export const getIssue = async (actor: Actor, key: string) => {
  const issue = await findIssue(actor, key);

  return await selectIssue(db, issue.id);
};

const invalid = (message: string) =>
  new ApiError(400, "invalid_request", message);

const findStatus = async (
  tx: TransactionSQL,
  projectId: string,
  statusId: string | undefined
) => {
  const [status] = await tx<{ category: StatusCategory; id: string }[]>`
    select id, category from statuses
    where project_id = ${projectId}
      and (${statusId ?? null}::uuid is null or id = ${statusId ?? null})
    order by category <> 'unstarted', position
    limit 1
  `;

  if (status === undefined) {
    throw invalid("Status not found in this project");
  }

  return status;
};

const checkAssignee = async (
  tx: TransactionSQL,
  workspaceId: string,
  assigneeId: string | null
) => {
  if (assigneeId === null) {
    return;
  }

  const rows = await tx<{ id: string }[]>`
    select u.id from users u
    where u.id = ${assigneeId}
      and (u.is_instance_admin or exists (
        select 1 from workspace_members m
        where m.user_id = u.id and m.workspace_id = ${workspaceId}
      ))
  `;

  if (rows.length === 0) {
    throw invalid("Assignee is not a workspace member");
  }
};

const checkLabels = async (
  tx: TransactionSQL,
  workspaceId: string,
  labelIds: string[]
) => {
  const unique = [...new Set(labelIds)];

  const [row] = await tx<{ count: number }[]>`
    select count(*)::int as count from labels
    where workspace_id = ${workspaceId}
      and id = any(${tx.array(unique, "uuid")})
  `;

  if (row?.count !== unique.length) {
    throw invalid("Label not found in this workspace");
  }

  return unique;
};

const nextLabels = async (
  tx: TransactionSQL,
  workspaceId: string,
  current: string[],
  changes: v.InferOutput<typeof UpdateIssueSchema>
) => {
  const { addLabelIds = [], labelIds, removeLabelIds = [] } = changes;

  if (labelIds !== undefined) {
    if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
      throw invalid(
        "Send labelIds or addLabelIds and removeLabelIds, not both"
      );
    }

    return await checkLabels(tx, workspaceId, labelIds);
  }

  const removed = new Set(removeLabelIds);

  if (addLabelIds.some((id) => removed.has(id))) {
    throw invalid("A label cannot be both added and removed");
  }

  const added = await checkLabels(tx, workspaceId, addLabelIds);
  const kept = new Set(current.filter((id) => !removed.has(id)));

  return [...kept.union(new Set(added))];
};

const closedDates = (category: StatusCategory) => ({
  canceledAt: category === "canceled" ? new Date() : null,
  completedAt: category === "completed" ? new Date() : null,
});

interface EventInput {
  from?: unknown;
  kind: IssueEventKind;
  to?: unknown;
}

export const recordEvents = async (
  tx: TransactionSQL,
  actor: Actor,
  issueId: string,
  events: EventInput[]
) => {
  if (events.length === 0) {
    return;
  }

  const rows = events.map(({ from, kind, to }) => ({
    from_value: from,
    id: Bun.randomUUIDv7(),
    kind,
    to_value: to,
  }));

  await tx`
    insert into issue_events (
      id, issue_id, actor_id, via_token_id, kind, from_value, to_value
    )
    select e.id, ${issueId}, ${actor.userId}, ${actor.tokenId ?? null},
      e.kind, e.from_value, e.to_value
    from jsonb_to_recordset(${rows}::jsonb)
      as e(id uuid, kind text, from_value jsonb, to_value jsonb)
  `;
};

const touchDescriptionEvent = async (
  tx: TransactionSQL,
  actor: Actor,
  issueId: string
) => {
  const touched = await tx<{ id: string }[]>`
    update issue_events set created_at = now()
    where id = (
      select id from issue_events where issue_id = ${issueId}
      order by created_at desc, id desc limit 1
    )
      and kind = 'description'
      and actor_id = ${actor.userId}
      and via_token_id is not distinct from ${actor.tokenId ?? null}::uuid
      and created_at > now() - interval '10 minutes'
    returning id
  `;

  return touched.length > 0;
};

export const createIssue = async (
  actor: Actor,
  projectKey: string,
  input: v.InferOutput<typeof CreateIssueSchema>
) => {
  const { project, workspaceId } = await findProject(actor, projectKey);
  const id = input.id ?? Bun.randomUUIDv7();

  await db.begin(async (tx) => {
    const [status, labelIds] = await Promise.all([
      findStatus(tx, project.id, input.statusId),
      checkLabels(tx, workspaceId, input.labelIds),
      checkAssignee(tx, workspaceId, input.assigneeId),
    ]);

    const [[counter], [first]] = await Promise.all([
      tx<{ number: number }[]>`
        update projects set issue_counter = issue_counter + 1
        where id = ${project.id}
        returning issue_counter as number
      `,
      tx<{ sortKey: string | null }[]>`
        select min(sort_key) as "sortKey" from issues
        where project_id = ${project.id} and status_id = ${status.id}
      `,
    ]);

    const checklist = countChecklist(input.description);
    const dates = closedDates(status.category);

    const inserted = await tx<{ id: string }[]>`
      insert into issues (
        id, project_id, number, title, description_md, status_id, priority,
        assignee_id, creator_id, sort_key, checklist_done, checklist_total,
        completed_at, canceled_at
      ) values (
        ${id}, ${project.id}, ${counter?.number}, ${input.title},
        ${input.description}, ${status.id}, ${input.priority},
        ${input.assigneeId}, ${actor.userId},
        ${input.sortKey ?? generateKeyBetween(null, first?.sortKey ?? null)},
        ${checklist.done}, ${checklist.total}, ${dates.completedAt},
        ${dates.canceledAt}
      )
      on conflict (id) do nothing
      returning id
    `;

    if (inserted.length === 0) {
      throw new ApiError(409, "conflict", "An issue with this id exists");
    }

    if (labelIds.length > 0) {
      await tx`
        insert into issue_labels ${tx(
          labelIds.map((labelId) => ({ issue_id: id, label_id: labelId }))
        )}
      `;
    }

    await recordEvents(tx, actor, id, [{ kind: "created" }]);
  });

  publish(workspaceId, { entity: "issue", id, projectId: project.id });
  void refreshEmbedding("issue", id);

  return await selectIssue(db, id);
};

interface IssueRow {
  assigneeId: string | null;
  deletedAt: Date | null;
  description: string;
  labelIds: string[];
  priority: number;
  sortKey: string;
  statusId: string;
  title: string;
  version: number;
}

export const lockIssue = async (tx: TransactionSQL, id: string) => {
  await tx`select 1 from issues where id = ${id} for update`;

  const [row] = await tx<IssueRow[]>`
    select title, description_md as description, status_id as "statusId",
      priority, assignee_id as "assigneeId", sort_key as "sortKey", version,
      deleted_at as "deletedAt",
      array(
        select label_id::text from issue_labels where issue_id = issues.id
      ) as "labelIds"
    from issues where id = ${id}
  `;

  if (row === undefined) {
    throw notFound("Issue");
  }

  return row;
};

const changeEvents = (
  row: IssueRow,
  next: Omit<IssueRow, "deletedAt" | "version">
) => {
  const events: EventInput[] = [];

  for (const kind of ["title", "priority"] as const) {
    if (row[kind] !== next[kind]) {
      events.push({ from: row[kind], kind, to: next[kind] });
    }
  }

  if (row.statusId !== next.statusId) {
    events.push({ from: row.statusId, kind: "status", to: next.statusId });
  }

  if (row.assigneeId !== next.assigneeId) {
    events.push({
      from: row.assigneeId,
      kind: "assignee",
      to: next.assigneeId,
    });
  }

  const before = new Set(row.labelIds);
  const after = new Set(next.labelIds);

  for (const labelId of after.difference(before)) {
    events.push({ kind: "label_added", to: labelId });
  }

  for (const labelId of before.difference(after)) {
    events.push({ from: labelId, kind: "label_removed" });
  }

  return events;
};

export const updateIssue = async (
  actor: Actor,
  key: string,
  changes: v.InferOutput<typeof UpdateIssueSchema>
) => {
  const issue = await findIssue(actor, key);

  const changed = await db.begin(async (tx) => {
    const row = await lockIssue(tx, issue.id);

    if (changes.version !== undefined && changes.version !== row.version) {
      throw new ApiError(
        409,
        "conflict",
        `${key.toUpperCase()} changed since version ${changes.version}`,
        await selectIssue(tx, issue.id)
      );
    }

    if (row.deletedAt !== null) {
      throw new ApiError(
        409,
        "deleted",
        `${key.toUpperCase()} is deleted`,
        await selectIssue(tx, issue.id)
      );
    }

    const next = {
      assigneeId:
        changes.assigneeId === undefined ? row.assigneeId : changes.assigneeId,
      description: changes.description ?? row.description,
      labelIds: await nextLabels(tx, issue.workspaceId, row.labelIds, changes),
      priority: changes.priority ?? row.priority,
      sortKey: changes.sortKey ?? row.sortKey,
      statusId: changes.statusId ?? row.statusId,
      title: changes.title ?? row.title,
    };

    const events = changeEvents(row, next);
    const descriptionChanged = row.description !== next.description;

    if (
      events.length === 0 &&
      !descriptionChanged &&
      row.sortKey === next.sortKey
    ) {
      return false;
    }

    if (row.assigneeId !== next.assigneeId) {
      await checkAssignee(tx, issue.workspaceId, next.assigneeId);
    }

    const statusChanged = row.statusId !== next.statusId;

    const status = await findStatus(tx, issue.projectId, next.statusId);
    const dates = closedDates(status.category);

    const checklist = countChecklist(next.description);

    await tx`
      update issues set
        title = ${next.title},
        description_md = ${next.description},
        status_id = ${next.statusId},
        priority = ${next.priority},
        assignee_id = ${next.assigneeId},
        sort_key = ${next.sortKey},
        checklist_done = ${checklist.done},
        checklist_total = ${checklist.total},
        completed_at = case when ${statusChanged}
          then ${dates.completedAt}::timestamptz else completed_at end,
        canceled_at = case when ${statusChanged}
          then ${dates.canceledAt}::timestamptz else canceled_at end,
        version = version + 1,
        updated_at = now()
      where id = ${issue.id}
    `;

    if (events.some(({ kind }) => kind.startsWith("label_"))) {
      await tx`delete from issue_labels where issue_id = ${issue.id}`;

      if (next.labelIds.length > 0) {
        await tx`
          insert into issue_labels ${tx(
            next.labelIds.map((labelId) => ({
              issue_id: issue.id,
              label_id: labelId,
            }))
          )}
        `;
      }
    }

    if (
      descriptionChanged &&
      !(await touchDescriptionEvent(tx, actor, issue.id))
    ) {
      events.push({ kind: "description" });
    }

    await recordEvents(tx, actor, issue.id, events);

    return true;
  });

  if (changed) {
    publish(issue.workspaceId, {
      entity: "issue",
      id: issue.id,
      projectId: issue.projectId,
    });
    void refreshEmbedding("issue", issue.id);
  }

  return await selectIssue(db, issue.id);
};

const setDeleted = async (actor: Actor, key: string, deleted: boolean) => {
  const issue = await findIssue(actor, key);

  const changed = await db.begin(async (tx) => {
    const row = await lockIssue(tx, issue.id);

    if (deleted && row.deletedAt !== null) {
      throw new ApiError(
        409,
        "deleted",
        `${key.toUpperCase()} is already deleted`,
        await selectIssue(tx, issue.id)
      );
    }

    if (!deleted && row.deletedAt === null) {
      return false;
    }

    await tx`
      update issues set
        deleted_at = ${deleted ? new Date() : null},
        deleted_by = ${deleted ? actor.userId : null},
        version = version + 1,
        updated_at = now()
      where id = ${issue.id}
    `;

    await recordEvents(tx, actor, issue.id, [
      { kind: deleted ? "deleted" : "restored" },
    ]);

    return true;
  });

  if (changed) {
    publish(issue.workspaceId, {
      entity: "issue",
      id: issue.id,
      projectId: issue.projectId,
    });
  }

  return await selectIssue(db, issue.id);
};

export const deleteIssue = async (actor: Actor, key: string) =>
  await setDeleted(actor, key, true);

export const restoreIssue = async (actor: Actor, key: string) =>
  await setDeleted(actor, key, false);

export const listIssueEvents = async (actor: Actor, key: string) => {
  const issue = await findIssue(actor, key);

  return await db<IssueEvent[]>`
    select e.id, e.kind, e.from_value as "fromValue", e.to_value as "toValue",
      e.created_at as "createdAt", e.via_token_id is not null as "viaApi",
      case when u.id is null then null else ${userRef} end as actor
    from issue_events e
    left join users u on u.id = e.actor_id
    where e.issue_id = ${issue.id}
    order by e.created_at, e.id
  `;
};

export const escapeLike = (text: string) => text.replaceAll(/[\\%_]/gu, "\\$&");

// oxlint-disable-next-line typescript/promise-function-async -- Returns an unexecuted Bun SQL fragment, which is thenable.
const issueFilters = (actor: Actor, query: IssueQuery) => {
  const assignees = query.assignee.map((value) =>
    value === "me" || value === "@me" ? actor.userId : value.replace(/^@/u, "")
  );

  return db`
    ${
      query.status.length === 0
        ? db``
        : db`and (
            s.id::text = any(${db.array(query.status, "text")})
            or lower(s.name) = any(${db.array(query.status, "text")})
          )`
    }
    ${
      query.priority.length === 0
        ? db``
        : db`and i.priority = any(${db.array(query.priority, "int2")})`
    }
    ${
      assignees.length === 0
        ? db``
        : db`and (
            (${assignees.includes("none")} and i.assignee_id is null)
            or i.assignee_id::text = any(${db.array(assignees, "text")})
            or i.assignee_id in (
              select id from users
              where lower(username) = any(${db.array(assignees, "text")})
            )
          )`
    }
    ${
      query.label.length === 0
        ? db``
        : db`and exists (
            select 1 from issue_labels il join labels l on l.id = il.label_id
            where il.issue_id = i.id and (
              l.id::text = any(${db.array(query.label, "text")})
              or lower(l.name) = any(${db.array(query.label, "text")})
            )
          )`
    }
    ${
      query.q === ""
        ? db``
        : db`and (
            i.title ilike ${`%${escapeLike(query.q)}%`}
            or lower(p.key || '-' || i.number) = lower(${query.q})
            or i.search @@ websearch_to_tsquery('english', ${query.q})
          )`
    }
  `;
};

const listIssues = async (
  actor: Actor,
  scope: { projectId: string } | { workspaceId: string },
  query: IssueQuery
) => {
  const where =
    "projectId" in scope
      ? db`i.project_id = ${scope.projectId}`
      : db`p.workspace_id = ${scope.workspaceId}`;

  const state =
    query.closed === "true"
      ? db`
          and s.category in ('completed', 'canceled')
          order by coalesce(i.completed_at, i.canceled_at) desc, i.id desc
          limit ${query.limit} offset ${query.offset}
        `
      : db`
          and (
            s.category not in ('completed', 'canceled')
            or coalesce(i.completed_at, i.canceled_at)
              > now() - interval '14 days'
          )
          order by i.sort_key, i.id
        `;

  return await db<IssueSummary[]>`
    select ${summaryColumns}
    from issues i
    join projects p on p.id = i.project_id
    join statuses s on s.id = i.status_id
    where ${where} and i.deleted_at is null
      ${issueFilters(actor, query)}
      ${state}
  `;
};

export const listProjectIssues = async (
  actor: Actor,
  key: string,
  query: IssueQuery
) => {
  const { project } = await findProject(actor, key);

  return await listIssues(actor, { projectId: project.id }, query);
};

export const countProjectIssues = async (
  actor: Actor,
  key: string,
  query: IssueQuery
) => {
  const { project } = await findProject(actor, key);

  return await db<StatusCount[]>`
    select i.status_id as "statusId", count(*)::int as count
    from issues i
    join projects p on p.id = i.project_id
    join statuses s on s.id = i.status_id
    where i.project_id = ${project.id} and i.deleted_at is null
      ${issueFilters(actor, query)}
    group by i.status_id
  `;
};

export const listWorkspaceIssues = async (
  actor: Actor,
  slug: string,
  query: IssueQuery
) => {
  const workspace = await requireWorkspace(actor, slug);

  return await listIssues(actor, { workspaceId: workspace.id }, query);
};
