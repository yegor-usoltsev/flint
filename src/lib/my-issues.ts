import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { api, useMe } from "~/lib/api";
import type { IssueSummary, ProjectDetail, Status } from "~/lib/api-types";
import { byClosed, isClosedStatus, matches } from "~/lib/issue-view";
import type { MineSearch } from "~/lib/issue-view";
import {
  assignedIssuesQuery,
  projectQuery,
  projectsQuery,
} from "~/lib/queries";

const closedPage = 50;

export const closedMineQuery = (slug: string) =>
  infiniteQueryOptions({
    getNextPageParam: (last: IssueSummary[], pages) =>
      last.length < closedPage ? undefined : pages.length * closedPage,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      await api<IssueSummary[]>(
        `/workspaces/${slug}/issues?${new URLSearchParams([
          ["assignee", "me"],
          ["closed", "true"],
          ["limit", String(closedPage)],
          ["offset", String(pageParam)],
        ]).toString()}`
      ),
    queryKey: ["issues", "workspace", slug, "closed", "mine"],
  });

const priorityRank = (issue: IssueSummary) =>
  issue.priority === 0 ? 5 : issue.priority;

const byUpdated = (a: IssueSummary, b: IssueSummary) =>
  b.updatedAt.localeCompare(a.updatedAt);

const byPriority = (a: IssueSummary, b: IssueSummary) =>
  priorityRank(a) - priorityRank(b) || byUpdated(a, b);

const projectKeyOf = (issue: IssueSummary) => issue.key.split("-")[0] ?? "";

export const mineStatuses = (projects: ProjectDetail[]) => {
  const shown = new Map<string, Status>();

  for (const project of projects) {
    for (const status of project.statuses) {
      if (!shown.has(status.name)) {
        shown.set(status.name, status);
      }
    }
  }

  return [...shown.values()].toSorted((a, b) => a.position - b.position);
};

export const arrangeMine = (
  issues: IssueSummary[],
  projects: ProjectDetail[],
  search: MineSearch
) => {
  const statuses = new Map(
    projects.flatMap((project) =>
      project.statuses.map((status) => [status.id, status] as const)
    )
  );

  const all = mineStatuses(projects);
  const wanted = new Set(search.status);

  const shown =
    wanted.size === 0 ? all : all.filter((status) => wanted.has(status.name));

  const columns = new Map<string, IssueSummary[]>(
    shown.map((status) => [status.name, []])
  );

  const visible = issues.filter(
    (issue) =>
      matches(search.project, [projectKeyOf(issue)]) &&
      matches(search.status, [statuses.get(issue.statusId)?.name ?? ""]) &&
      matches(search.priority, [issue.priority]) &&
      matches(search.label, issue.labelIds)
  );

  const order = search.order === "updated" ? byUpdated : byPriority;

  for (const issue of visible.toSorted(order)) {
    columns.get(statuses.get(issue.statusId)?.name ?? "")?.push(issue);
  }

  for (const status of shown) {
    if (isClosedStatus(status)) {
      columns.get(status.name)?.sort(byClosed);
    }
  }

  return {
    columns: Object.fromEntries(
      shown.map((status) => [
        status.id,
        (columns.get(status.name) ?? []).map((issue) => issue.id),
      ])
    ),
    ordered: shown.flatMap((status) => columns.get(status.name) ?? []),
    shown,
    statuses,
    visible,
  };
};

export const mergeClosed = (
  open: IssueSummary[],
  closed: IssueSummary[] | undefined
) => {
  const ids = new Set(open.map((issue) => issue.id));

  const rest = (closed ?? []).filter((issue) => {
    if (ids.has(issue.id)) {
      return false;
    }

    ids.add(issue.id);

    return true;
  });

  return [...open, ...rest];
};

export const mineGroups = (
  shown: Status[],
  columns: Record<string, string[]>,
  keepClosed: boolean
) => {
  const filled = (status: Status) => (columns[status.id]?.length ?? 0) > 0;

  const last =
    shown.findLast((status) => isClosedStatus(status) && filled(status)) ??
    shown.findLast(isClosedStatus);

  return {
    groups: shown.filter(
      (status) =>
        !isClosedStatus(status) ||
        filled(status) ||
        (keepClosed && status === last)
    ),
    lastClosed: last?.id,
  };
};

export const createTarget = (
  projects: ProjectDetail[],
  statusName: string,
  filter: string[] | undefined
) => {
  const targets = projects.flatMap((project) => {
    const status = project.statuses.find((item) => item.name === statusName);

    return status === undefined
      ? []
      : [{ projectKey: project.key, statusId: status.id }];
  });

  return (
    targets.find((target) => matches(filter, [target.projectKey])) ?? targets[0]
  );
};

export const useMyIssues = (
  slug: string,
  search: MineSearch = {},
  enabled = true
) => {
  const meId = useMe().data?.id;
  const projects = useQuery({ ...projectsQuery(slug), enabled });
  const list = enabled ? (projects.data ?? []) : [];

  const details = useQueries({
    queries: list.map((project) => projectQuery(project.key)),
  });

  const lists = useQueries({
    queries:
      meId === undefined
        ? []
        : list.map((project) => assignedIssuesQuery(project, meId)),
  });

  const closed = useInfiniteQuery({
    ...closedMineQuery(slug),
    enabled: enabled && search.closed === true,
  });

  const queries = [
    ...details,
    ...lists,
    ...(search.closed === true ? [closed] : []),
  ];

  const loaded = details.flatMap((query) =>
    query.data === undefined ? [] : [query.data]
  );

  const open = lists.flatMap(
    (query) => query.data?.filter((issue) => issue.assigneeId === meId) ?? []
  );

  const issues = mergeClosed(
    open,
    search.closed === true
      ? closed.data?.pages.flat().filter((issue) => issue.assigneeId === meId)
      : undefined
  );

  return {
    ...arrangeMine(issues, loaded, search),
    closed,
    failed: queries.some((query) => query.isError),
    pending: queries.some((query) => query.isPending),
    projects: loaded,
    retry: () => {
      for (const query of queries) {
        if (query.isError) {
          void query.refetch();
        }
      }
    },
    total: issues.length,
  };
};

export const useMineSearchUpdates = () => {
  const navigate = useNavigate();

  const setSearch = (patch: MineSearch) => {
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, ...patch }),
      to: ".",
    });
  };

  const clearFilters = () => {
    void navigate({
      replace: true,
      search: ({
        label: _l,
        priority: _p,
        project: _project,
        status: _s,
        ...rest
      }) => rest,
      to: ".",
    });
  };

  return { clearFilters, setSearch };
};
