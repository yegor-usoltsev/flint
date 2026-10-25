import { expect, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { IssueSummary, Status } from "~/lib/api-types";
import type { IssueSearch } from "~/lib/issue-view";
import {
  filterIssues,
  groupIssues,
  IssueSearchSchema,
  isFiltered,
  orderIssues,
  sortKeyBetween,
  withKnownLabels,
} from "~/lib/issue-view";

const issue = (
  id: string,
  fields: Partial<IssueSummary> = {}
): IssueSummary => ({
  assigneeId: null,
  canceledAt: null,
  checklistDone: 0,
  checklistTotal: 0,
  ciState: null,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  creatorId: "u1",
  id,
  key: `ENG-${id}`,
  labelIds: [],
  number: 1,
  priority: 0,
  projectId: "p1",
  pullRequestState: null,
  sortKey: "a0",
  statusId: "todo",
  title: id,
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  ...fields,
});

const status = (id: string, position: number): Status => ({
  category: "unstarted",
  color: "gray",
  id,
  name: id,
  position,
});

const ids = (issues: IssueSummary[] | undefined) =>
  issues?.map((item) => item.id);

test("filters OR within a property and AND across properties", () => {
  const issues = [
    issue("1", { assigneeId: "alice", labelIds: ["bug"], priority: 1 }),
    issue("2", { labelIds: ["bug", "ui"], priority: 2 }),
    issue("3", { assigneeId: "bob", labelIds: ["ui"], priority: 1 }),
  ];

  expect(ids(filterIssues(issues, {}))).toEqual(["1", "2", "3"]);
  expect(ids(filterIssues(issues, { label: ["bug", "ui"] }))).toEqual([
    "1",
    "2",
    "3",
  ]);
  expect(
    ids(filterIssues(issues, { assignee: ["none", "bob"], priority: [1] }))
  ).toEqual(["3"]);
});

test("groups by status in status order and sorts each order", () => {
  const issues = [
    issue("a", { priority: 0, sortKey: "a1", updatedAt: "2026-10-03" }),
    issue("b", { priority: 4, sortKey: "a0", updatedAt: "2026-10-01" }),
    issue("c", { priority: 1, sortKey: "a2", updatedAt: "2026-10-02" }),
    issue("d", { sortKey: "a0", statusId: "done" }),
  ];

  const statuses = [status("todo", 1), status("done", 2)];

  expect([...groupIssues(issues, statuses, "manual").keys()]).toEqual([
    "todo",
    "done",
  ]);
  expect(ids(groupIssues(issues, statuses, "manual").get("todo"))).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(ids(groupIssues(issues, statuses, "priority").get("todo"))).toEqual([
    "c",
    "b",
    "a",
  ]);
  expect(ids(groupIssues(issues, statuses, "updated").get("todo"))).toEqual([
    "a",
    "c",
    "b",
  ]);
});

const workflow: Status[] = [
  { ...status("backlog", 0), category: "backlog" },
  { ...status("todo", 1), category: "unstarted" },
  { ...status("doing", 2), category: "started" },
  { ...status("review", 3), category: "started" },
  { ...status("done", 4), category: "completed" },
  { ...status("canceled", 5), category: "canceled" },
];

test("closed groups order by completion time, newest first, in every order", () => {
  const issues = [
    issue("old", {
      completedAt: "2026-09-01T00:00:00Z",
      sortKey: "a0",
      statusId: "done",
    }),
    issue("new", {
      completedAt: "2026-10-20T00:00:00Z",
      sortKey: "a2",
      statusId: "done",
    }),
    issue("mid", {
      completedAt: "2026-10-01T00:00:00Z",
      sortKey: "a1",
      statusId: "done",
    }),
    issue("x", {
      canceledAt: "2026-08-01T00:00:00Z",
      sortKey: "a0",
      statusId: "canceled",
    }),
    issue("y", {
      canceledAt: "2026-10-05T00:00:00Z",
      sortKey: "a1",
      statusId: "canceled",
    }),
    issue("t2", { sortKey: "a1", statusId: "todo" }),
    issue("t1", { sortKey: "a0", statusId: "todo" }),
  ];

  for (const order of ["manual", "priority", "updated"] as const) {
    const groups = groupIssues(issues, workflow, order);

    expect(ids(groups.get("done"))).toEqual(["new", "mid", "old"]);
    expect(ids(groups.get("canceled"))).toEqual(["y", "x"]);
  }

  expect(ids(orderIssues(issues, workflow, {}))).toEqual([
    "t1",
    "t2",
    "new",
    "mid",
    "old",
    "y",
    "x",
  ]);
});

test("sort keys land between neighbors and survive equal neighbors", () => {
  const between = sortKeyBetween("a0", "a1");

  expect(between > "a0" && between < "a1").toBe(true);
  expect(sortKeyBetween(undefined, "a0") < "a0").toBe(true);
  expect(sortKeyBetween("a0", "a0") > "a0").toBe(true);
});

test("search params drop invalid values instead of failing the route", () => {
  const search = v.parse(IssueSearchSchema, {
    order: "random",
    priority: [9],
    status: ["s1"],
  });

  expect(search.order).toBeUndefined();
  expect(search.priority).toBeUndefined();
  expect(search.status).toEqual(["s1"]);
});

test("a filter on a deleted label is ignored once the labels have loaded", () => {
  const search: IssueSearch = { label: ["gone", "bug"], priority: [1] };

  expect(withKnownLabels(search, undefined)).toBe(search);
  expect(withKnownLabels(search, [{ id: "bug" }])).toEqual({
    label: ["bug"],
    priority: [1],
  });
  expect(isFiltered(withKnownLabels({ label: ["gone"] }, []))).toBe(false);
});
