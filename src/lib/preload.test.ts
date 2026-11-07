import { afterEach, expect, spyOn, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { loadMyIssues } from "~/lib/preload";

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

test("My issues preloads assigned rows in one workspace request", async () => {
  const queryClient = new QueryClient();
  const requested: string[] = [];

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();

        requested.push(path);

        const body = {
          "/api/v1/me": { id: "alice" },
          "/api/v1/workspaces/acme/projects?counts=false": [
            { id: "p", key: "ENG" },
          ],
          "/api/v1/projects/ENG": { id: "p", key: "ENG", statuses: [] },
          "/api/v1/workspaces/acme/issues?assignee=me": [{ id: "mine" }],
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

  expect(requested.toSorted()).toEqual([
    "/api/v1/me",
    "/api/v1/projects/ENG",
    "/api/v1/workspaces/acme/issues?assignee=me",
    "/api/v1/workspaces/acme/projects",
  ]);
  expect(queryClient.getQueryData(["issues", "p"])).toBeUndefined();
  expect(
    queryClient.getQueryData(["issues", "workspace", "acme", "mine", "alice"])
  ).toEqual([{ id: "mine" }]);

  await queryClient.invalidateQueries({
    queryKey: ["issues", "workspace", "acme"],
  });

  expect(
    queryClient.getQueryState(["issues", "workspace", "acme", "mine", "alice"])
      ?.isInvalidated
  ).toBe(true);
  queryClient.clear();
});
