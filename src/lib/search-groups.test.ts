import { describe, expect, test } from "bun:test";

import { resultGroups } from "~/lib/search-groups";

const issue = (key: string, score: number) => ({ id: key, score });

const page = (path: string, score: number) => ({ id: path, score });

const outline = (groups: ReturnType<typeof resultGroups>) =>
  groups.map(({ extra, hits, kind, open }) => ({
    extra,
    ids: hits.map(({ id }) => id),
    kind,
    open,
  }));

const issues = Array.from({ length: 8 }, (_, index) =>
  issue(`API-${index + 1}`, 0.02 - index * 0.001)
);

describe("search result groups", () => {
  test("puts the kind with the best hit first and caps each kind", () => {
    expect(
      outline(
        resultGroups(issues, [page("runbooks/deploy-rollback", 0.03)], [])
      )
    ).toEqual([
      {
        extra: 0,
        ids: ["runbooks/deploy-rollback"],
        kind: "pages",
        open: false,
      },
      {
        extra: 3,
        ids: ["API-1", "API-2", "API-3", "API-4", "API-5"],
        kind: "issues",
        open: false,
      },
    ]);
  });

  test("keeps issues first on a tie and shows a kind in full once expanded", () => {
    const groups = resultGroups(issues, [page("a", 0.02)], ["issues"]);

    expect(outline(groups).map(({ kind, open }) => [kind, open])).toEqual([
      ["issues", true],
      ["pages", false],
    ]);
    expect(groups[0]?.hits).toHaveLength(8);
  });

  test("drops empty kinds", () => {
    expect(outline(resultGroups([], [], []))).toEqual([]);
  });
});
