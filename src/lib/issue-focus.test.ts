import { describe, expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import type { Issue } from "~/lib/api-types";
import { cachedIssues, findIssue } from "~/lib/issue-focus";

const issue = (id: string, deletedAt: string | null = null): Issue => ({
  assigneeId: null,
  canceledAt: null,
  checklistDone: 0,
  checklistTotal: 0,
  ciState: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  creatorId: "u",
  deletedAt,
  description: "",
  id,
  key: `ENG-${id}`,
  labelIds: [],
  links: [],
  number: 1,
  priority: 0,
  projectId: "p",
  pullRequestState: null,
  sortKey: "a0",
  statusId: "todo",
  title: id,
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
});

describe("issue targets", () => {
  test("a deleted detail record is never a target", () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(["issues", "p"], [issue("1")]);
    queryClient.setQueryData(
      ["issues", "p", "detail", "ENG-2"],
      issue("2", "2026-01-02T00:00:00Z")
    );

    expect(findIssue(queryClient, "2")).toBeNull();
    expect(
      cachedIssues(queryClient, [issue("1"), issue("2")]).map(({ id }) => id)
    ).toEqual(["1"]);
  });
});
