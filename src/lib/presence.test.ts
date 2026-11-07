import { afterEach, expect, mock, spyOn, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { Presence } from "~/lib/api-types";
import { applyPresence, presenceQuery, viewTarget } from "~/lib/presence";

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

test("a remount in the same tick sends one beacon with the final targets", async () => {
  const listeners = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const browser = {
    document: { ...listeners, visibilityState: "visible" },
    navigator: { sendBeacon: (_url: string, _data: Blob) => true },
    window: listeners,
  };

  const saved = Object.keys(browser).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  );

  for (const [name, value] of Object.entries(browser)) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }

  const beacon = spyOn(browser.navigator, "sendBeacon");

  viewTarget("acme", "issue")();

  const leave = viewTarget("acme", "issue");

  await Bun.sleep(5);

  const bodies = await Promise.all(
    beacon.mock.calls.map(async ([, data]) => await data.text())
  );

  leave();
  await Bun.sleep(5);

  for (const [name, descriptor] of saved) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('"targetIds":["issue"]');
});
