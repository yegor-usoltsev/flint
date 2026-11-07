import { afterEach, expect, mock, spyOn, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { Presence } from "~/lib/api-types";
import { applyPresence, presenceQuery } from "~/lib/presence";

afterEach(() => {
  mock.restore();
});

test("an event during the snapshot request makes it fetch again", async () => {
  const queryClient = new QueryClient();

  const snapshots: Presence[][] = [
    [],
    [{ targetId: "issue", userIds: ["bob"] }],
  ];

  const pending = Promise.withResolvers<Response>();
  let calls = 0;

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        calls += 1;

        return calls === 1
          ? await pending.promise
          : Response.json(snapshots[1]);
      },
      { preconnect: fetch.preconnect }
    )
  );

  const observer = new QueryObserver(queryClient, presenceQuery("acme"));
  const unsubscribe = observer.subscribe(() => {});

  applyPresence(queryClient, "acme", {
    entity: "presence",
    id: "issue",
    projectId: null,
    userIds: ["bob"],
  });
  pending.resolve(Response.json(snapshots[0]));

  await Bun.sleep(20);

  expect(queryClient.getQueryData(presenceQuery("acme").queryKey)).toEqual(
    snapshots[1]
  );
  expect(calls).toBe(2);

  applyPresence(queryClient, "acme", {
    entity: "presence",
    id: "issue",
    projectId: null,
    userIds: [],
  });

  expect(queryClient.getQueryData(presenceQuery("acme").queryKey)).toEqual([
    { targetId: "issue", userIds: [] },
  ]);
  expect(calls).toBe(2);
  unsubscribe();
});
