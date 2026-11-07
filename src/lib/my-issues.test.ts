import { expect, test } from "bun:test";

import type { IssueSummary, ProjectDetail, Status } from "~/lib/api-types";
import { arrangeMine, mineStatuses } from "~/lib/my-issues";

const status = (
  id: string,
  name: string,
  position: number,
  category: Status["category"] = "unstarted"
): Status => ({ category, color: "gray", id, name, position });

const project = (key: string, statuses: Status[]): ProjectDetail => ({
  color: "gray",
  icon: "box",
  id: key.toLowerCase(),
  key,
  name: key,
  statuses,
  workspaceSlug: "acme",
});

const eng = project("ENG", [
  status("eng-todo", "Todo", 1),
  status("eng-review", "In Review", 3),
  status("eng-done", "Done", 4, "completed"),
]);

const des = project("DES", [
  status("des-todo", "Todo", 1),
  status("des-doing", "In Progress", 2),
  status("des-done", "Done", 4, "completed"),
]);

const issue = (
  key: string,
  statusId: string,
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
  id: key,
  key,
  labelIds: [],
  number: 1,
  priority: 0,
  projectId: key.split("-")[0]?.toLowerCase() ?? "",
  pullRequestState: null,
  sortKey: "a0",
  statusId,
  title: key,
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  ...fields,
});

const issues = [
  issue("ENG-1", "eng-todo", { priority: 3 }),
  issue("DES-1", "des-todo", { priority: 1 }),
  issue("DES-2", "des-doing", { labelIds: ["bug"] }),
  issue("ENG-2", "eng-review", {
    labelIds: ["bug"],
    updatedAt: "2026-10-05T00:00:00Z",
  }),
];

test("merges statuses from every project by name in position order", () => {
  expect(mineStatuses([eng, des]).map((item) => item.name)).toEqual([
    "Todo",
    "In Progress",
    "In Review",
    "Done",
  ]);
});

test("groups issues of all projects under shared status names", () => {
  const { columns, ordered } = arrangeMine(issues, [eng, des], {});

  expect(columns).toEqual({
    "des-doing": ["DES-2"],
    "eng-done": [],
    "eng-review": ["ENG-2"],
    "eng-todo": ["DES-1", "ENG-1"],
  });
  expect(ordered.map((item) => item.key)).toEqual([
    "DES-1",
    "ENG-1",
    "DES-2",
    "ENG-2",
  ]);
});

test("filters by project, status name and label", () => {
  const byProject = arrangeMine(issues, [eng, des], { project: ["DES"] });

  expect(byProject.ordered.map((item) => item.key)).toEqual(["DES-1", "DES-2"]);

  const byStatus = arrangeMine(issues, [eng, des], { status: ["Todo"] });

  expect(byStatus.shown.map((item) => item.name)).toEqual(["Todo"]);
  expect(byStatus.ordered.map((item) => item.key)).toEqual(["DES-1", "ENG-1"]);

  const byLabel = arrangeMine(issues, [eng, des], { label: ["bug"] });

  expect(byLabel.visible.map((item) => item.key)).toEqual(["DES-2", "ENG-2"]);
});

test("orders by last update when asked", () => {
  const { columns } = arrangeMine(
    [
      issue("ENG-1", "eng-todo", { priority: 1 }),
      issue("DES-1", "des-todo", { updatedAt: "2026-10-09T00:00:00Z" }),
    ],
    [eng, des],
    { order: "updated" }
  );

  expect(columns["eng-todo"]).toEqual(["DES-1", "ENG-1"]);
});
