// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { Presence } from "~/lib/api-types";
import { requireWorkspace } from "~/server/access.server";
import { ApiError } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { publish } from "~/server/realtime.server";

export const presenceTtlMs = 45_000;

const sweepMs = 10_000;
const tabsPerUser = 20;

export const PresenceSchema = v.object({
  tab: v.pipe(v.string(), v.uuid()),
  targetIds: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(4)),
});

interface Tab {
  expiresAt: number;
  targetIds: string[];
  userId: string;
}

const workspaces = new Map<string, Map<string, Tab>>();
let sweeper: ReturnType<typeof setInterval> | null = null;

const viewers = (workspaceId: string, targetId: string) => [
  ...new Set(
    [...(workspaces.get(workspaceId)?.values() ?? [])].flatMap((tab) =>
      tab.targetIds.includes(targetId) ? [tab.userId] : []
    )
  ),
];

const setTab = (workspaceId: string, key: string, tab: Tab | undefined) => {
  const tabs = workspaces.get(workspaceId) ?? new Map<string, Tab>();

  const touched = [
    ...new Set([
      ...(tabs.get(key)?.targetIds ?? []),
      ...(tab?.targetIds ?? []),
    ]),
  ];

  const before = touched.map((id) => viewers(workspaceId, id).length);

  if (tab === undefined) {
    tabs.delete(key);
  } else {
    tabs.set(key, tab);
  }

  if (tabs.size === 0) {
    workspaces.delete(workspaceId);
  } else {
    workspaces.set(workspaceId, tabs);
  }

  for (const [index, targetId] of touched.entries()) {
    const userIds = viewers(workspaceId, targetId);

    if (userIds.length !== before[index]) {
      publish(workspaceId, {
        entity: "presence",
        id: targetId,
        projectId: null,
        userIds,
      });
    }
  }

  if (workspaces.size === 0) {
    clearInterval(sweeper ?? undefined);
    sweeper = null;
  }
};

export const sweepPresence = (now = Date.now()) => {
  for (const [workspaceId, tabs] of workspaces) {
    for (const [key, tab] of tabs) {
      if (tab.expiresAt <= now) {
        setTab(workspaceId, key, undefined);
      }
    }
  }
};

export const updatePresence = async (
  actor: Actor,
  slug: string,
  { tab, targetIds }: v.InferOutput<typeof PresenceSchema>
) => {
  const workspace = await requireWorkspace(actor, slug);
  const key = `${actor.userId} ${tab}`;
  const tabs = workspaces.get(workspace.id);

  if (targetIds.length === 0) {
    setTab(workspace.id, key, undefined);

    return;
  }

  if (
    tabs?.has(key) !== true &&
    [...(tabs?.values() ?? [])].filter((item) => item.userId === actor.userId)
      .length >= tabsPerUser
  ) {
    throw new ApiError(
      429,
      "rate_limited",
      `Up to ${tabsPerUser} tabs per account show presence`
    );
  }

  setTab(workspace.id, key, {
    expiresAt: Date.now() + presenceTtlMs,
    targetIds: [...new Set(targetIds)],
    userId: actor.userId,
  });
  sweeper ??= setInterval(sweepPresence, sweepMs);
};

export const listPresence = async (
  actor: Actor,
  slug: string
): Promise<Presence[]> => {
  const workspace = await requireWorkspace(actor, slug);

  const targetIds = new Set(
    [...(workspaces.get(workspace.id)?.values() ?? [])].flatMap(
      (tab) => tab.targetIds
    )
  );

  return [...targetIds].map((targetId) => ({
    targetId,
    userIds: viewers(workspace.id, targetId),
  }));
};
