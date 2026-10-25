import { describe, expect, test } from "bun:test";

import type { IssueSummary, Status } from "~/lib/api-types";
import { pickerChecked, pickerWrites } from "~/lib/issue-options";

const status = (id: string, name: string): Status => ({
  category: "unstarted",
  color: "gray",
  id,
  name,
  position: 0,
});

const statuses = new Map([
  ["eng", [status("eng-todo", "Todo"), status("eng-done", "Done")]],
  ["ops", [status("ops-todo", "Todo"), status("ops-review", "Review")]],
]);

const issue = (
  key: string,
  projectId: string,
  fields: Partial<IssueSummary> = {}
): IssueSummary => ({
  assigneeId: null,
  canceledAt: null,
  checklistDone: 0,
  checklistTotal: 0,
  ciState: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  creatorId: "u",
  id: key,
  key,
  labelIds: [],
  number: 1,
  priority: 0,
  projectId,
  pullRequestState: null,
  sortKey: "a0",
  statusId: `${projectId}-todo`,
  title: key,
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
  ...fields,
});

const option = (value: string, label = value) => ({ icon: null, label, value });

describe("bulk property changes", () => {
  test("a status applies by name in each issue's project", () => {
    const issues = [issue("ENG-1", "eng"), issue("OPS-1", "ops")];

    expect(
      pickerWrites("status", issues, option("ops-todo", "Todo"), statuses)
    ).toEqual([]);
    expect(
      pickerChecked("status", issues, option("eng-todo", "Todo"), statuses)
    ).toBe(true);

    const writes = pickerWrites(
      "status",
      issues,
      option("eng-done", "Done"),
      statuses
    );

    expect(writes.map(({ issue: item, patch }) => [item.key, patch])).toEqual([
      ["ENG-1", { statusId: "eng-done" }],
    ]);
  });

  test("priority and assignee write only issues that change", () => {
    const issues = [
      issue("ENG-1", "eng", { priority: 2 }),
      issue("ENG-2", "eng", { assigneeId: "me" }),
    ];

    expect(
      pickerWrites("priority", issues, option("2"), statuses).map(
        ({ patch }) => patch
      )
    ).toEqual([{ priority: 2 }]);
    expect(
      pickerWrites("assignee", issues, option("none"), statuses).map(
        ({ issue: item, patch }) => [item.key, patch]
      )
    ).toEqual([["ENG-2", { assigneeId: null }]]);
    expect(pickerChecked("priority", issues, option("2"), statuses)).toBe(
      false
    );
  });

  test("a label is added where missing, or removed when every issue has it", () => {
    const issues = [
      issue("ENG-1", "eng", { labelIds: ["bug"] }),
      issue("ENG-2", "eng", { labelIds: ["ui"] }),
    ];

    expect(
      pickerWrites("labels", issues, option("bug"), statuses).map(
        ({ issue: item, patch }) => [item.key, patch]
      )
    ).toEqual([["ENG-2", { addLabelIds: ["bug"] }]]);

    const both = [
      issue("ENG-1", "eng", { labelIds: ["bug", "ui"] }),
      issue("ENG-2", "eng", { labelIds: ["bug"] }),
    ];

    expect(pickerChecked("labels", both, option("bug"), statuses)).toBe(true);
    expect(
      pickerWrites("labels", both, option("bug"), statuses).map(
        ({ patch }) => patch
      )
    ).toEqual([{ removeLabelIds: ["bug"] }, { removeLabelIds: ["bug"] }]);
  });
});
