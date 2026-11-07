import { describe, expect, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { Issue } from "~/lib/api-types";
import {
  cachedIssues,
  findIssue,
  findListedIssueByKey,
} from "~/lib/issue-focus";

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

  test("only a current list counts as listing a key", () => {
    const queryClient = new QueryClient();

    const shown = (queryKey: string[]) =>
      new QueryObserver(queryClient, {
        queryKey,
        staleTime: Infinity,
      }).subscribe(() => {});

    queryClient.setQueryData(["issues", "p"], [issue("1")]);
    queryClient.setQueryData(["issues", "p", "detail", "ENG-2"], issue("2"));
    queryClient.setQueryData(["issues", "q"], [issue("3")]);

    const stops = [
      shown(["issues", "p"]),
      shown(["issues", "p", "detail", "ENG-2"]),
    ];

    expect(findListedIssueByKey(queryClient, "ENG-1")?.id).toBe("1");
    expect(findListedIssueByKey(queryClient, "ENG-2")).toBeNull();
    expect(findListedIssueByKey(queryClient, "ENG-3")?.id).toBe("3");
    void queryClient.invalidateQueries({
      queryKey: ["issues", "q"],
      refetchType: "none",
    });
    expect(findListedIssueByKey(queryClient, "ENG-3")).toBeNull();

    for (const stop of stops) {
      stop();
    }
  });
});
