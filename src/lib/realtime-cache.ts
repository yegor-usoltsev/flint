import type {
  InfiniteData,
  Query,
  QueryCache,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { ApiError, request } from "~/lib/api";
import type {
  Comment,
  Issue,
  IssueEvent,
  IssueField,
  IssueSummary,
  RealtimeEvent,
  WikiPage,
  WikiPageSummary,
} from "~/lib/api-types";
import { maxIssueLimit } from "~/lib/endpoints";
import { filterKeys } from "~/lib/issue-view";

type IssueData = Issue | IssueSummary[] | InfiniteData<IssueSummary[]>;

interface Timeline {
  comments: Comment[];
  events: IssueEvent[];
}

interface Plan {
  partials: Map<string, { query: Query; run: () => Promise<void> }>;
  stale: Set<Query>;
}

export const entityKeys = (slug: string, event: RealtimeEvent): QueryKey[] =>
  ({
    attachment: [["attachments"]],
    comment: [],
    issue: [],
    label: [["workspaces", slug, "labels"], ["issues"]],
    member: [["workspaces", slug, "members"], ["me"]],
    presence: [],
    project: [
      ["workspaces", slug, "projects"],
      ["projects"],
      ["workspaces", slug, "labels"],
    ],
    wiki: [],
    workspace: [["me"], ["workspaces", slug], ["projects"]],
  })[event.entity];

export const refresh = async (
  queryClient: QueryClient,
  predicate: (query: Query) => boolean
) => {
  const preloads = queryClient
    .getQueryCache()
    .findAll({ fetchStatus: "fetching", predicate, type: "inactive" });

  await queryClient.cancelQueries({ predicate });
  await Promise.allSettled([
    queryClient.invalidateQueries({ predicate }),
    ...preloads.map(async (query) => await query.fetch()),
  ]);
};

const markStale = (cache: QueryCache, plan: Plan, queryKey: QueryKey) => {
  for (const query of cache.findAll({ queryKey })) {
    plan.stale.add(query);
  }
};

const rowsOf = (data: IssueData | undefined): IssueSummary[] => {
  if (data === undefined) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  return "pages" in data ? data.pages.flat() : [data];
};

const withIssue = (
  data: IssueData | undefined,
  issue: IssueSummary
): IssueData | undefined => {
  const one = <Row extends IssueSummary>(row: Row): Row =>
    row.id === issue.id && row.version < issue.version
      ? { ...row, ...issue }
      : row;

  if (data === undefined || Array.isArray(data)) {
    return data?.map(one);
  }

  return "pages" in data
    ? { ...data, pages: data.pages.map((page) => page.map(one)) }
    : one(data);
};

const FilterKeySchema = v.picklist(filterKeys);

const FiltersSchema = v.union([
  v.array(v.tuple([FilterKeySchema, v.string()])),
  v.record(FilterKeySchema, v.optional(v.array(v.unknown()))),
]);

const filterFields = {
  assignee: "assignee",
  label: "labels",
  priority: "priority",
  status: "status",
} as const satisfies Record<(typeof filterKeys)[number], IssueField>;

const filteredBy = (query: Query): IssueField[] => {
  const { 1: scope, 2: kind, 3: part } = query.queryKey;

  if (scope === "workspace" || kind === "assigned") {
    return ["assignee"];
  }

  const filters = v.safeParse(FiltersSchema, part);

  if (!filters.success) {
    return [];
  }

  const { output } = filters;

  const keys = Array.isArray(output)
    ? output.map(([key]) => key)
    : filterKeys.filter((key) => (output[key]?.length ?? 0) > 0);

  return keys.map((key) => filterFields[key]);
};

const regroups = (
  query: Query,
  fields: Set<IssueField>,
  present: boolean,
  size: number
) => {
  const { 1: scope, 2: kind } = query.queryKey;
  const status = fields.has("status");

  if (kind === "detail") {
    return false;
  }

  if (filteredBy(query).some((field) => fields.has(field))) {
    return true;
  }

  if (kind === "closed" || kind === "counts" || scope === "workspace") {
    return status;
  }

  if (size >= maxIssueLimit) {
    return status || fields.size === 0;
  }

  return status && !present;
};

const latest = new Map<string, symbol>();

const timelinePart = <Value>(
  queryClient: QueryClient,
  plan: Plan,
  {
    issueId,
    load,
    merge,
    part,
  }: {
    issueId: string;
    load: () => Promise<Value>;
    merge: (timeline: Timeline, value: Value) => Timeline;
    part: string;
  }
) => {
  const query = queryClient
    .getQueryCache()
    .find({ exact: true, queryKey: ["timeline", issueId] });

  if (query === undefined) {
    return;
  }

  if (
    !query.isActive() ||
    query.state.data === undefined ||
    query.state.fetchStatus === "fetching"
  ) {
    plan.stale.add(query);

    return;
  }

  const slot = `${query.queryHash}:${part}`;

  const run = async () => {
    const token = Symbol(slot);

    latest.set(slot, token);

    const loaded = await load().then(
      (value) => ({ value }),
      () => null
    );

    if (latest.get(slot) !== token) {
      return;
    }

    latest.delete(slot);

    if (loaded === null || query.state.fetchStatus === "fetching") {
      await refresh(queryClient, (item) => item === query);
    } else {
      queryClient.setQueryData<Timeline>(
        query.queryKey,
        (timeline) => timeline && merge(timeline, loaded.value)
      );
    }
  };

  plan.partials.set(slot, { query, run });
};

const issueQueries = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent
) => [
  ...queryClient
    .getQueryCache()
    .findAll({ queryKey: ["issues", event.projectId] }),
  ...queryClient
    .getQueryCache()
    .findAll({ queryKey: ["issues", "workspace", slug] }),
];

const movedIssue = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent,
  plan: Plan
) => {
  for (const query of issueQueries(queryClient, slug, event)) {
    const data = queryClient.getQueryData<IssueData>(query.queryKey);

    if (
      query.queryKey[2] !== "detail" ||
      data === undefined ||
      rowsOf(data).some((row) => row.id === event.id)
    ) {
      plan.stale.add(query);
    }
  }

  for (const queryKey of [
    ["timeline", event.id],
    ["workspaces", slug, "projects"],
    ["workspaces", slug, "labels"],
    ["workspaces", slug, "trash"],
  ]) {
    markStale(queryClient.getQueryCache(), plan, queryKey);
  }
};

const changedIssue = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent,
  plan: Plan
) => {
  const cache = queryClient.getQueryCache();
  const { id, issue } = event;

  if (issue === undefined || event.fields === undefined) {
    movedIssue(queryClient, slug, event, plan);

    return;
  }

  const fields = new Set(event.fields);

  for (const query of issueQueries(queryClient, slug, event)) {
    const { 2: kind, 3: key } = query.queryKey;

    if (kind === "detail" && key !== issue.key) {
      continue;
    }

    const data = queryClient.getQueryData<IssueData>(query.queryKey);
    const rows = rowsOf(data);
    const present = rows.some((row) => row.id === id);

    const fetching =
      kind !== "counts" && query.state.fetchStatus === "fetching";

    if (
      fetching ||
      regroups(query, fields, present, rows.length) ||
      (kind === "detail" && fields.has("description"))
    ) {
      plan.stale.add(query);
    }

    if (present) {
      queryClient.setQueryData<IssueData>(query.queryKey, (current) =>
        withIssue(current, issue)
      );
    }
  }

  if (fields.size > 0) {
    timelinePart(queryClient, plan, {
      issueId: id,
      load: async () =>
        await request("GET /issues/:issueKey/activity", {
          params: { issueKey: issue.key },
        }),
      merge: (timeline, events) => ({ ...timeline, events }),
      part: "activity",
    });
  }

  if (fields.has("status")) {
    markStale(cache, plan, ["workspaces", slug, "projects"]);
  }

  if (fields.has("labels")) {
    markStale(cache, plan, ["workspaces", slug, "labels"]);
  }
};

const byCreated = (a: Comment, b: Comment) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

const withComment = (
  timeline: Timeline,
  id: string,
  comment: Comment | null
): Timeline => {
  const known = timeline.comments.find((item) => item.id === id);
  const others = timeline.comments.filter((item) => item.id !== id);

  if (comment === null) {
    return { ...timeline, comments: others };
  }

  return known !== undefined && known.version > comment.version
    ? timeline
    : { ...timeline, comments: [...others, comment].toSorted(byCreated) };
};

const loadComment = async (id: string) => {
  try {
    return await request("GET /comments/:commentId", {
      params: { commentId: id },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
};

const changedComment = (
  queryClient: QueryClient,
  event: RealtimeEvent,
  plan: Plan
) => {
  if (event.issueId !== undefined) {
    timelinePart(queryClient, plan, {
      issueId: event.issueId,
      load: async () => await loadComment(event.id),
      merge: (timeline, comment) => withComment(timeline, event.id, comment),
      part: `comment:${event.id}`,
    });
  }
};

const changedPage = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent,
  plan: Plan
) => {
  const cache = queryClient.getQueryCache();
  const { id, page } = event;

  const trees = cache.findAll({
    exact: true,
    queryKey: ["wiki", slug, "pages"],
  });

  const listed = (tree: Query) =>
    tree.state.fetchStatus !== "fetching" &&
    (queryClient.getQueryData<WikiPageSummary[]>(tree.queryKey) ?? []).some(
      (row) => row.id === id
    );

  markStale(cache, plan, ["doc", id]);

  if (page === undefined || trees.length === 0 || !trees.every(listed)) {
    markStale(cache, plan, ["wiki", slug]);
    markStale(cache, plan, ["workspaces", slug, "trash"]);

    return;
  }

  for (const tree of trees) {
    queryClient.setQueryData<WikiPageSummary[]>(tree.queryKey, (pages) =>
      pages?.map((row) =>
        row.id === id && row.revision < page.revision
          ? { ...row, ...page }
          : row
      )
    );
  }

  for (const query of cache.findAll({ queryKey: ["wiki", slug, "page"] })) {
    const shown = queryClient.getQueryData<WikiPage>(query.queryKey);
    const older = shown?.id === id && shown.revision < page.revision;

    const loading =
      query.queryKey[3] === page.path && query.state.fetchStatus === "fetching";

    if (older || loading) {
      plan.stale.add(query);
    }
  }

  markStale(cache, plan, ["wiki", slug, "revisions", id]);
  markStale(cache, plan, ["wiki", slug, "id", id]);
};

export const applyEvents = async (
  queryClient: QueryClient,
  slug: string,
  events: RealtimeEvent[]
) => {
  const plan: Plan = { partials: new Map(), stale: new Set() };

  for (const event of events) {
    if (event.entity === "issue") {
      changedIssue(queryClient, slug, event, plan);
    } else if (event.entity === "comment") {
      changedComment(queryClient, event, plan);
    } else if (event.entity === "wiki") {
      changedPage(queryClient, slug, event, plan);
    } else {
      for (const queryKey of entityKeys(slug, event)) {
        markStale(queryClient.getQueryCache(), plan, queryKey);
      }
    }
  }

  const partials = [...plan.partials.values()].filter(
    ({ query }) => !plan.stale.has(query)
  );

  await Promise.allSettled([
    refresh(queryClient, (query) => plan.stale.has(query)),
    ...partials.map(async ({ run }) => {
      await run();
    }),
  ]);
};
