import { afterEach, expect, spyOn, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { loadMyIssues } from "~/lib/preload";

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

test("My issues preloads assigned rows without filling full project lists", async () => {
  const queryClient = new QueryClient();
  const requested: string[] = [];

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();

        requested.push(path);

        const body = {
          "/api/v1/me": { id: "alice" },
          "/api/v1/workspaces/acme/projects": [{ id: "p", key: "ENG" }],
          "/api/v1/projects/ENG": { id: "p", key: "ENG", statuses: [] },
          "/api/v1/projects/ENG/issues?assignee=me": [{ id: "mine" }],
        }[path];

        return await Promise.resolve(
          Response.json(body ?? { error: "unexpected" }, {
            status: body ? 200 : 500,
          })
        );
      },
      { preconnect: fetch.preconnect }
    )
  );

  await loadMyIssues(queryClient, "acme");

  expect(requested).toContain("/api/v1/projects/ENG/issues?assignee=me");
  expect(requested).not.toContain("/api/v1/projects/ENG/issues");
  expect(queryClient.getQueryData(["issues", "p"])).toBeUndefined();
  expect(
    queryClient.getQueryData(["issues", "p", "assigned", "alice"])
  ).toEqual([{ id: "mine" }]);
  expect(
    queryClient.getQueryData(["issues", "p", "assigned", "bob"])
  ).toBeUndefined();

  await queryClient.invalidateQueries({ queryKey: ["issues", "p"] });

  expect(
    queryClient.getQueryState(["issues", "p", "assigned", "alice"])
      ?.isInvalidated
  ).toBe(true);
  queryClient.clear();
});
