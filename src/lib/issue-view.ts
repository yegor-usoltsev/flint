import { generateKeyBetween } from "fractional-indexing";
import { useSyncExternalStore } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { IssueSummary, Status } from "~/lib/api-types";

const Ids = v.fallback(v.optional(v.array(v.string())), undefined);

export const IssueSearchSchema = v.object({
  assignee: Ids,
  closed: v.fallback(v.optional(v.boolean()), undefined),
  label: Ids,
  order: v.fallback(
    v.optional(v.picklist(["manual", "priority", "updated"])),
    undefined
  ),
  priority: v.fallback(
    v.optional(v.array(v.picklist([0, 1, 2, 3, 4]))),
    undefined
  ),
  status: Ids,
});

export type IssueSearch = v.InferOutput<typeof IssueSearchSchema>;

export type Order = NonNullable<IssueSearch["order"]>;

export const MineSearchSchema = v.object({
  closed: IssueSearchSchema.entries.closed,
  label: Ids,
  order: v.fallback(v.optional(v.picklist(["updated"])), undefined),
  priority: IssueSearchSchema.entries.priority,
  project: Ids,
  status: Ids,
});

export type MineSearch = v.InferOutput<typeof MineSearchSchema>;

export type FilterKey =
  | "assignee"
  | "label"
  | "priority"
  | "project"
  | "status";

export type FilterValues = Partial<
  Record<FilterKey, readonly (number | string)[] | undefined>
>;

export const filterKeys = ["status", "priority", "assignee", "label"] as const;

export const mineFilterKeys = [
  "project",
  "status",
  "priority",
  "label",
] as const;

export const matches = <Value>(
  values: readonly Value[] | undefined,
  actual: Value[]
) => {
  if (values === undefined || values.length === 0) {
    return true;
  }

  const wanted = new Set(values);

  return actual.some((value) => wanted.has(value));
};

export const filterIssues = (issues: IssueSummary[], search: IssueSearch) =>
  issues.filter(
    (issue) =>
      matches(search.status, [issue.statusId]) &&
      matches(search.priority, [issue.priority]) &&
      matches(search.assignee, [issue.assigneeId ?? "none"]) &&
      matches(search.label, issue.labelIds)
  );

export const shownStatuses = (statuses: Status[], search: IssueSearch) => {
  const shown = new Set(search.status);

  return shown.size === 0
    ? statuses
    : statuses.filter((status) => shown.has(status.id));
};

export const withKnownLabels = <Search extends { label?: string[] }>(
  search: Search,
  labels: { id: string }[] | undefined
): Search => {
  if (labels === undefined || search.label === undefined) {
    return search;
  }

  const known = new Set(labels.map((label) => label.id));

  return { ...search, label: search.label.filter((id) => known.has(id)) };
};

export const isFiltered = (
  search: FilterValues,
  keys: readonly FilterKey[] = filterKeys
) => keys.some((key) => (search[key]?.length ?? 0) > 0);

const compareText = (a: string, b: string) => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

const byManual = (a: IssueSummary, b: IssueSummary) =>
  compareText(a.sortKey, b.sortKey) || compareText(a.id, b.id);

const priorityRank = (issue: IssueSummary) =>
  issue.priority === 0 ? 5 : issue.priority;

const comparators = {
  manual: byManual,
  priority: (a: IssueSummary, b: IssueSummary) =>
    priorityRank(a) - priorityRank(b) || byManual(a, b),
  updated: (a: IssueSummary, b: IssueSummary) =>
    compareText(b.updatedAt, a.updatedAt) || byManual(a, b),
} satisfies Record<Order, (a: IssueSummary, b: IssueSummary) => number>;

export const isClosedStatus = (status: Pick<Status, "category">) =>
  status.category === "completed" || status.category === "canceled";

const closedAt = (issue: IssueSummary) =>
  issue.completedAt ?? issue.canceledAt ?? "";

export const byClosed = (a: IssueSummary, b: IssueSummary) =>
  compareText(closedAt(b), closedAt(a)) || compareText(b.id, a.id);

export const groupIssues = (
  issues: IssueSummary[],
  statuses: Status[],
  order: Order
) => {
  const groups = new Map<string, IssueSummary[]>(
    statuses.map((status) => [status.id, []])
  );

  for (const issue of issues.toSorted(comparators[order])) {
    groups.get(issue.statusId)?.push(issue);
  }

  for (const status of statuses) {
    if (isClosedStatus(status)) {
      groups.get(status.id)?.sort(byClosed);
    }
  }

  return groups;
};

export const sortKeyBetween = (
  before: string | undefined,
  after: string | undefined
) => {
  try {
    return generateKeyBetween(before ?? null, after ?? null);
  } catch {
    return generateKeyBetween(before ?? null, null);
  }
};

const dateFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export type ViewKind = "board" | "list";

export const mineViewKey = "mine";

const viewKey = (projectKey: string) => `view:${projectKey}`;

const viewListeners = new Set<() => void>();

export const rememberView = (projectKey: string, view: ViewKind) => {
  localStorage.setItem(viewKey(projectKey), view);

  for (const listener of viewListeners) {
    listener();
  }
};

const subscribeView = (listener: () => void) => {
  viewListeners.add(listener);

  return () => {
    viewListeners.delete(listener);
  };
};

export const useProjectView = (projectKey: string): ViewKind =>
  useSyncExternalStore(
    subscribeView,
    () =>
      localStorage.getItem(viewKey(projectKey)) === "board" ? "board" : "list",
    () => "list"
  );

const collapsedKey = "collapsed-statuses";

const collapsedListeners = new Set<() => void>();

const storedCollapsed = () =>
  (localStorage.getItem(collapsedKey) ?? "")
    .split("\n")
    .filter((id) => id !== "");

export const setStatusCollapsed = (statusId: string, collapsed: boolean) => {
  const ids = storedCollapsed().filter((id) => id !== statusId);

  localStorage.setItem(
    collapsedKey,
    (collapsed ? [...ids, statusId] : ids).join("\n")
  );

  for (const listener of collapsedListeners) {
    listener();
  }
};

const subscribeCollapsed = (listener: () => void) => {
  collapsedListeners.add(listener);

  return () => {
    collapsedListeners.delete(listener);
  };
};

export const useStatusCollapsed = (statusId: string) =>
  useSyncExternalStore(
    subscribeCollapsed,
    () => storedCollapsed().includes(statusId),
    () => false
  );

export type IssueOrigin =
  | { panel?: string; projectKey: string; search: IssueSearch; view: ViewKind }
  | { panel?: string; search?: MineSearch; view: "mine" };

export const orderIssues = (
  issues: IssueSummary[],
  statuses: Status[],
  search: IssueSearch
) =>
  [
    ...groupIssues(
      filterIssues(issues, search),
      shownStatuses(statuses, search),
      search.order ?? "manual"
    ).values(),
  ].flat();

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const units = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
] as const;

export const formatRelative = (iso: string, now = Date.now()) => {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const unit = units.find(([, size]) => Math.abs(seconds) >= size);

  return unit === undefined
    ? "just now"
    : relativeFormat.format(Math.round(seconds / unit[1]), unit[0]);
};
