import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { api, ApiError } from "~/lib/api";
import type { Issue, IssueSummary } from "~/lib/api-types";
import { countChecklist } from "~/lib/checklist";
import { issueRequests } from "~/lib/limit";
import { notifyError } from "~/lib/notify";

const patchKeys = [
  "assigneeId",
  "description",
  "labelIds",
  "priority",
  "sortKey",
  "statusId",
  "title",
] as const satisfies (keyof Issue)[];

export interface LabelChanges {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export type IssuePatch = Partial<Pick<Issue, (typeof patchKeys)[number]>> &
  LabelChanges;

export const withLabelChanges = <T extends { labelIds: string[] }>(
  target: T,
  { addLabelIds, removeLabelIds, ...patch }: Partial<T> & LabelChanges
): T => {
  const next = { ...target, ...patch };

  if (addLabelIds === undefined && removeLabelIds === undefined) {
    return next;
  }

  const removed = new Set(removeLabelIds);
  const kept = new Set(next.labelIds.filter((id) => !removed.has(id)));

  return { ...next, labelIds: [...kept.union(new Set(addLabelIds))] };
};

export interface WriteOptions {
  expect?: Pick<IssuePatch, "description" | "title">;
  onConflict?: (current: Issue) => void;
  onError?: (error: Error) => void;
  onSaved?: (issue: Issue) => void;
}

interface Write extends WriteOptions {
  patch: IssuePatch;
  request?: (base: Issue | IssueSummary) => Promise<Issue>;
}

interface Queue {
  base: Issue | IssueSummary;
  projectId: string;
  writes: Write[];
}

type IssueData = Issue | IssueSummary[] | InfiniteData<IssueSummary[]>;

const queues = new Map<string, Queue>();
let reconcile = false;

export const hasPendingIssueWrites = () => queues.size > 0;

const mapIssues = (
  data: IssueData | undefined,
  id: string,
  update: (issue: IssueSummary) => IssueSummary
): IssueData | undefined => {
  if (data === undefined) {
    return data;
  }

  const one = (issue: IssueSummary) =>
    issue.id === id ? update(issue) : issue;

  if (Array.isArray(data)) {
    return data.map(one);
  }

  if ("pages" in data) {
    return { ...data, pages: data.pages.map((page) => page.map(one)) };
  }

  return { ...data, ...one(data) };
};

const withChecklist = (patch: Partial<Issue>): Partial<Issue> => {
  if (patch.description === undefined) {
    return patch;
  }

  const { done, total } = countChecklist(patch.description);

  return { ...patch, checklistDone: done, checklistTotal: total };
};

const summaryFields = ({
  deletedAt: _deleted,
  description: _description,
  links: _links,
  ...fields
}: Partial<Issue>) => fields;

const applyPatch = (
  issue: IssueSummary,
  patch: Partial<Issue> & LabelChanges
) => {
  const fields = withChecklist(patch);

  return withLabelChanges(issue, {
    ...("description" in issue ? fields : summaryFields(fields)),
  });
};

const applyPending = (issue: IssueSummary, writes: Write[]) => {
  let item = issue;

  for (const write of writes) {
    item = applyPatch(item, write.patch);
  }

  return item;
};

const setIssue = (
  queryClient: QueryClient,
  queue: Queue,
  update: (issue: IssueSummary) => IssueSummary
) => {
  queryClient.setQueriesData<IssueData>(
    { queryKey: ["issues", queue.projectId] },
    (data) => mapIssues(data, queue.base.id, update)
  );
};

const fromServer = (queryClient: QueryClient, queue: Queue, issue: Issue) => {
  queue.base = issue;

  setIssue(queryClient, queue, (item) =>
    applyPending(
      item.version > issue.version ? item : applyPatch(item, issue),
      queue.writes
    )
  );
};

const rollBack = (queryClient: QueryClient, queue: Queue, write: Write) => {
  const base: Partial<Issue> = queue.base;
  const restored: IssuePatch = {};

  const labels =
    "addLabelIds" in write.patch || "removeLabelIds" in write.patch;

  for (const key of patchKeys) {
    if ((key in write.patch || (key === "labelIds" && labels)) && key in base) {
      Object.assign(restored, { [key]: base[key] });
    }
  }

  setIssue(queryClient, queue, (item) =>
    applyPending(applyPatch(item, restored), queue.writes)
  );
};

const unchanged = (expect: Write["expect"], current: Issue) =>
  (expect?.description === undefined ||
    expect.description === current.description) &&
  (expect?.title === undefined || expect.title === current.title);

const fail = (
  queryClient: QueryClient,
  queue: Queue,
  write: Write,
  error: Error,
  current: Issue | undefined
) => {
  queue.writes.shift();
  reconcile = true;

  if (current === undefined) {
    rollBack(queryClient, queue, write);
  } else {
    fromServer(queryClient, queue, current);
  }

  if (current?.deletedAt === null && write.onConflict) {
    write.onConflict(current);
  } else if (write.onError) {
    write.onError(error);
  } else {
    notifyError(`Could not update ${queue.base.key}`)(error);
  }
};

const knownConflict = (queue: Queue, write: Write) =>
  write.expect !== undefined &&
  "description" in queue.base &&
  !unchanged(write.expect, queue.base)
    ? queue.base
    : undefined;

const saved = (queryClient: QueryClient, queue: Queue, issue: Issue) => {
  const [write] = queue.writes;

  queue.writes.shift();

  for (const next of queue.writes) {
    next.expect &&= {
      description:
        write?.patch.description === undefined
          ? next.expect.description
          : issue.description,
      title: write?.patch.title === undefined ? next.expect.title : issue.title,
    };
  }

  fromServer(queryClient, queue, issue);
  write?.onSaved?.(issue);
};

const failed = (
  queryClient: QueryClient,
  queue: Queue,
  write: Write,
  error: Error
) => {
  const conflict = error instanceof ApiError && error.status === 409;

  // SAFETY: a 409 from the issue API carries the canonical issue in `current`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The API contract types `current`.
  const current = conflict ? (error.current as Issue | undefined) : undefined;

  if (current?.deletedAt === null && unchanged(write.expect, current)) {
    queue.base = current;
  } else {
    fail(queryClient, queue, write, error, current);
  }
};

const send = async (queryClient: QueryClient, queue: Queue): Promise<void> => {
  const [write] = queue.writes;

  if (write === undefined) {
    queues.delete(queue.base.id);

    if (reconcile && queues.size === 0) {
      reconcile = false;
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
    }

    return;
  }

  const known = knownConflict(queue, write);

  if (known === undefined) {
    try {
      saved(
        queryClient,
        queue,
        await issueRequests(
          async () =>
            await (write.request?.(queue.base) ??
              api<Issue>(`/issues/${queue.base.key}`, {
                body:
                  write.expect === undefined
                    ? write.patch
                    : { ...write.patch, version: queue.base.version },
                method: "PATCH",
              }))
        )
      );
    } catch (error) {
      failed(
        queryClient,
        queue,
        write,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  } else {
    fail(queryClient, queue, write, new Error("Changed elsewhere"), known);
  }

  await send(queryClient, queue);
};

const queueFor = (issue: IssueSummary) =>
  queues.get(issue.id) ?? {
    base: issue,
    projectId: issue.projectId,
    writes: [],
  };

const start = (queryClient: QueryClient, queue: Queue) => {
  if (!queues.has(queue.base.id)) {
    queues.set(queue.base.id, queue);
    void send(queryClient, queue);
  }
};

export const queueIssueRequest = async (
  queryClient: QueryClient,
  issue: IssueSummary,
  request: (base: Issue | IssueSummary) => Promise<Issue>
) => {
  const { promise, reject, resolve } = Promise.withResolvers<Issue>();
  const queue = queueFor(issue);

  queue.writes.push({ onError: reject, onSaved: resolve, patch: {}, request });
  start(queryClient, queue);

  return await promise;
};

export const writeIssue = (
  queryClient: QueryClient,
  issue: IssueSummary,
  patch: IssuePatch,
  options: WriteOptions = {}
) => {
  const queue = queueFor(issue);

  const last = queue.writes.length > 1 ? queue.writes.at(-1) : undefined;

  if (
    last?.expect !== undefined &&
    options.expect !== undefined &&
    Object.keys(last.patch).join(",") === Object.keys(patch).join(",")
  ) {
    Object.assign(last, {
      ...options,
      expect: { ...options.expect, ...last.expect },
      patch: { ...last.patch, ...patch },
    });
  } else {
    queue.writes.push({ ...options, patch });
  }

  void queryClient.cancelQueries({ queryKey: ["issues", queue.projectId] });
  setIssue(queryClient, queue, (item) => applyPatch(item, patch));
  start(queryClient, queue);
};

export const writeIssues = (
  queryClient: QueryClient,
  writes: { issue: IssueSummary; patch: IssuePatch }[]
) => {
  if (writes.length < 2) {
    for (const { issue, patch } of writes) {
      writeIssue(queryClient, issue, patch);
    }

    return;
  }

  let pending = writes.length;
  const failures: { error: Error; key: string }[] = [];

  const settled = () => {
    pending -= 1;

    const [first] = failures;

    if (pending === 0 && first !== undefined) {
      notifyError(
        failures.length === 1
          ? `Could not update ${first.key}`
          : `Could not update ${failures.length} issues`
      )(first.error);
    }
  };

  for (const { issue, patch } of writes) {
    writeIssue(queryClient, issue, patch, {
      onError: (error) => {
        failures.push({ error, key: issue.key });
        settled();
      },
      onSaved: settled,
    });
  }
};

export const useUpdateIssue = () => {
  const queryClient = useQueryClient();

  return (issue: IssueSummary, patch: IssuePatch, options?: WriteOptions) => {
    writeIssue(queryClient, issue, patch, options);
  };
};

const flatIssues = (data: IssueData | undefined): IssueSummary[] => {
  if (data === undefined) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  return "pages" in data ? data.pages.flat() : [data];
};

export const findCachedIssue = (
  queryClient: QueryClient,
  projectId: string,
  key: string
) =>
  queryClient
    .getQueriesData<IssueData>({ queryKey: ["issues", projectId] })
    .flatMap(([, data]) => flatIssues(data))
    .find((issue) => issue.key === key);
