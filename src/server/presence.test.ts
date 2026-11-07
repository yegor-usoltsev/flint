import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { ApiError } from "~/server/api.server";
import { addMember } from "~/server/members.server";
import {
  listPresence,
  presenceTtlMs,
  sweepPresence,
  updatePresence,
} from "~/server/presence.server";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Spying on publish needs the module namespace.
import * as realtime from "~/server/realtime.server";
import { createWorkspace } from "~/server/workspaces.server";

import { createUser, resetDatabase, stubGiteaUsers } from "../../test/helpers";

const issueId = "01a1abf7-471a-72d0-9d84-03cee588953d";
const projectId = "01a1761a-d79c-72ae-aa56-1c8b5eeb281c";
const tabA = "01a1761a-0000-7000-8000-00000000000a";
const tabB = "01a1761a-0000-7000-8000-00000000000b";

beforeEach(async () => {
  sweepPresence(Number.POSITIVE_INFINITY);
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  sweepPresence(Number.POSITIVE_INFINITY);
  mock.restore();
});

const setup = async () => {
  const alice = { userId: await createUser("alice") };
  const bob = { userId: await createUser("bob") };
  const mallory = { userId: await createUser("mallory") };

  await createWorkspace(alice, { name: "Acme", slug: "acme" });
  await addMember(alice, "acme", { role: "member", username: "bob" });

  const events = spyOn(realtime, "publish").mockImplementation(() => {
    /* recorded */
  });

  const published = () =>
    events.mock.calls.map(([, event]) => [event.id, event.userIds]);

  return { alice, bob, mallory, published };
};

test("publishes only when the viewers of a target change", async () => {
  const { alice, bob, published } = await setup();

  await updatePresence(alice, "acme", { tab: tabA, targetIds: [issueId] });
  await updatePresence(alice, "acme", { tab: tabA, targetIds: [issueId] });
  await updatePresence(alice, "acme", { tab: tabB, targetIds: [issueId] });
  await updatePresence(bob, "acme", { tab: tabA, targetIds: [issueId] });

  expect(published()).toEqual([
    [issueId, [alice.userId]],
    [issueId, [alice.userId, bob.userId]],
  ]);
  expect(await listPresence(bob, "acme")).toEqual([
    { targetId: issueId, userIds: [alice.userId, bob.userId] },
  ]);

  await updatePresence(alice, "acme", { tab: tabA, targetIds: [] });
  await updatePresence(alice, "acme", { tab: tabB, targetIds: [projectId] });

  expect(published().slice(2)).toEqual([
    [issueId, [bob.userId]],
    [projectId, [alice.userId]],
  ]);
});

test("a tab that stops reporting expires in one sweep", async () => {
  const { alice, bob, published } = await setup();
  const start = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(start);

  await updatePresence(alice, "acme", {
    tab: tabA,
    targetIds: [projectId, issueId],
  });
  await updatePresence(bob, "acme", { tab: tabA, targetIds: [projectId] });
  clock.mockReturnValue(start + presenceTtlMs / 2);
  sweepPresence();
  await updatePresence(bob, "acme", { tab: tabA, targetIds: [projectId] });

  expect(published()).toHaveLength(3);

  sweepPresence(start + presenceTtlMs);

  expect(published().slice(3)).toEqual([
    [projectId, [bob.userId]],
    [issueId, []],
  ]);
  expect(await listPresence(bob, "acme")).toEqual([
    { targetId: projectId, userIds: [bob.userId] },
  ]);
});

const status = async (call: Promise<unknown>) => {
  try {
    await call;

    return 200;
  } catch (error) {
    return error instanceof ApiError ? error.status : 500;
  }
};

test("outsiders get 404 and leave no presence", async () => {
  const { alice, mallory, published } = await setup();

  expect(
    await status(
      updatePresence(mallory, "acme", { tab: tabA, targetIds: [issueId] })
    )
  ).toBe(404);
  expect(await status(listPresence(mallory, "acme"))).toBe(404);
  expect(await listPresence(alice, "acme")).toEqual([]);
  expect(published()).toEqual([]);
});
