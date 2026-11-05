import { expect, mock, spyOn, test } from "bun:test";

import { Route as issuesRoute } from "~/routes/api/v1/projects/$key/issues";
import { checkHealth } from "~/server/health.server";
import { perMinute, roundRobin } from "~/server/limits.server";
import { createProject } from "~/server/projects.server";
import { s3 } from "~/server/s3.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  callApi,
  createUser,
  resetDatabase,
  sessionCookieFor,
  stubGiteaUsers,
} from "../../test/helpers";

test("the image queue takes turns between users, so one user's backlog does not hold up another", async () => {
  const queue = roundRobin();
  const order: string[] = [];

  const task = (name: string) => async () => {
    await Bun.sleep(1);
    order.push(name);
  };

  await Promise.all([
    queue("alice", task("alice 1")),
    queue("alice", task("alice 2")),
    queue("alice", task("alice 3")),
    queue("bob", task("bob 1")),
  ]);

  expect(order).toEqual(["alice 1", "bob 1", "alice 2", "alice 3"]);
});

test("an account joining the image queue waits behind accounts already waiting", async () => {
  const queue = roundRobin();
  const order: string[] = [];
  const { promise: finished, resolve } = Promise.withResolvers<string[]>();

  const brings = new Map([
    ["alice 1", "carol"],
    ["carol", "dave"],
    ["dave", "erin"],
  ]);

  const task = (name: string) => async () => {
    const arriving = brings.get(name);

    if (arriving !== undefined) {
      void queue(arriving, task(arriving));
    }

    await Bun.sleep(1);
    order.push(name);

    if (order.length === 5) {
      resolve(order);
    }
  };

  void queue("alice", task("alice 1"));
  void queue("alice", task("alice 2"));

  expect(await finished).toEqual([
    "alice 1",
    "carol",
    "alice 2",
    "dave",
    "erin",
  ]);
});

test("a per-minute allowance refills over the minute, per key", () => {
  let now = 0;
  const realNow = Date.now;

  Date.now = () => now;

  try {
    const allowed = perMinute(() => 2);

    expect([allowed("a"), allowed("a"), allowed("a"), allowed("b")]).toEqual([
      true,
      true,
      false,
      true,
    ]);

    now = 30_000;

    expect([allowed("a"), allowed("a")]).toEqual([true, false]);
  } finally {
    Date.now = realNow;
  }
});

test("a JSON body over 4 MB is refused before parsing, and a label list over 100 ids is invalid", async () => {
  await resetDatabase();
  stubGiteaUsers();

  const rootId = await createUser("root");

  await createWorkspace({ userId: rootId }, { name: "Acme", slug: "acme" });
  await createProject({ userId: rootId }, "acme", {
    color: "blue",
    key: "ENG",
    name: "E",
  });

  const auth = await sessionCookieFor(rootId);

  const post = async (body: { labelIds?: string[]; title: string }) =>
    await callApi(issuesRoute, auth, "POST", "/api/v1/projects/ENG/issues", {
      body,
      params: { key: "ENG" },
    });

  expect(await post({ title: "x".repeat(5 * 1024 * 1024) })).toMatchObject({
    body: { error: { code: "too_large" } },
    status: 413,
  });
  expect(
    await post({
      labelIds: Array.from({ length: 101 }, () => Bun.randomUUIDv7()),
      title: "Many labels",
    })
  ).toMatchObject({
    body: { error: { code: "invalid_request" } },
    status: 400,
  });
  expect(await post({ title: "Fine" })).toMatchObject({ status: 201 });
  mock.restore();
});

test("the health check reuses its result for two seconds, so a flood of probes costs one bucket listing", async () => {
  const realNow = Date.now;
  let now = realNow() + 10_000;
  const list = spyOn(s3, "list");

  Date.now = () => now;

  try {
    await Promise.all([checkHealth(), checkHealth(), checkHealth()]);
    now += 1999;
    await checkHealth();

    expect(list).toHaveBeenCalledTimes(1);

    now += 1;
    await checkHealth();

    expect(list).toHaveBeenCalledTimes(2);
  } finally {
    Date.now = realNow;
    mock.restore();
  }
});

test("a health probe slower than the cache window is shared until it settles, and gives up after three seconds", async () => {
  const realNow = Date.now;
  let now = realNow() + 60_000;

  const list = spyOn(s3, "list").mockImplementation(
    async () => await Promise.withResolvers<never>().promise
  );

  Date.now = () => now;

  try {
    const first = checkHealth();

    now += 2500;

    const second = checkHealth();

    expect(list).toHaveBeenCalledTimes(1);
    expect(await Promise.all([first, second])).toEqual([
      { db: "ok", s3: "error" },
      { db: "ok", s3: "error" },
    ]);

    now += 1999;
    await checkHealth();

    expect(list).toHaveBeenCalledTimes(1);
  } finally {
    Date.now = realNow;
    mock.restore();
  }
});

test("an account returning to an empty queue waits behind accounts already waiting", async () => {
  const queue = roundRobin();
  const order: string[] = [];

  const task = (name: string, during?: () => void) => async () => {
    during?.();
    await Bun.sleep(1);
    order.push(name);
  };

  const later: Promise<void>[] = [];

  await Promise.all([
    queue("alice", task("alice 1")),
    queue(
      "bob",
      task("bob", () => {
        later.push(
          queue("carol", task("carol")),
          queue("alice", task("alice 2"))
        );
      })
    ),
  ]);
  await Promise.all(later);

  expect(order).toEqual(["alice 1", "bob", "carol", "alice 2"]);
});
