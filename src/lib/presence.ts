import { queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { request, useMe } from "~/lib/api";
import type { Member, Presence, RealtimeEvent } from "~/lib/api-types";
import { endpointPath } from "~/lib/endpoints";
import { membersQuery } from "~/lib/queries";

const heartbeatMs = 25_000;

export const presenceQuery = (slug: string) =>
  queryOptions({
    queryFn: async () =>
      await request("GET /workspaces/:slug/presence", { params: { slug } }),
    queryKey: ["workspaces", slug, "presence"],
    staleTime: Number.POSITIVE_INFINITY,
  });

export const applyPresence = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent
) => {
  queryClient.setQueryData<Presence[]>(
    presenceQuery(slug).queryKey,
    (current) =>
      current && [
        ...current.filter((item) => item.targetId !== event.id),
        { targetId: event.id, userIds: event.userIds ?? [] },
      ]
  );
};

const tab = typeof crypto === "undefined" ? "" : crypto.randomUUID();
const viewed = new Map<string, Map<string, number>>();
let timer: ReturnType<typeof setInterval> | null = null;

const send = (slug: string, targetIds: string[]) => {
  const { path } = endpointPath("POST /workspaces/:slug/presence", { slug });
  const body = JSON.stringify({ tab, targetIds });

  navigator.sendBeacon(
    `/api/v1${path}`,
    new Blob([body], { type: "application/json" })
  );
};

const report = (slug: string) => {
  send(slug, [...(viewed.get(slug)?.keys() ?? [])]);
};

const beat = () => {
  if (document.visibilityState === "visible") {
    for (const slug of viewed.keys()) {
      report(slug);
    }
  }
};

const leaveAll = () => {
  for (const slug of viewed.keys()) {
    send(slug, []);
  }
};

const start = () => {
  timer = setInterval(beat, heartbeatMs);
  document.addEventListener("visibilitychange", beat);
  window.addEventListener("pageshow", beat);
  window.addEventListener("pagehide", leaveAll);
};

const stop = () => {
  clearInterval(timer ?? undefined);
  timer = null;
  document.removeEventListener("visibilitychange", beat);
  window.removeEventListener("pageshow", beat);
  window.removeEventListener("pagehide", leaveAll);
};

const view = (slug: string, targetId: string) => {
  const targets = viewed.get(slug) ?? new Map<string, number>();
  const count = targets.get(targetId) ?? 0;

  targets.set(targetId, count + 1);
  viewed.set(slug, targets);

  if (timer === null) {
    start();
  }

  if (count === 0 && document.visibilityState === "visible") {
    report(slug);
  }

  return () => {
    const left = (targets.get(targetId) ?? 1) - 1;

    if (left > 0) {
      targets.set(targetId, left);

      return;
    }

    targets.delete(targetId);
    report(slug);

    if (targets.size === 0) {
      viewed.delete(slug);
    }

    if (viewed.size === 0) {
      stop();
    }
  };
};

export const usePresence = (slug: string, targetId: string) => {
  const me = useMe().data?.id;
  const members = useQuery(membersQuery(slug)).data;
  const presence = useQuery(presenceQuery(slug)).data;

  useEffect(() => view(slug, targetId), [slug, targetId]);

  const userIds =
    presence?.find((item) => item.targetId === targetId)?.userIds ?? [];

  return userIds.flatMap((userId): Member[] => {
    const member = members?.find((item) => item.userId === userId);

    return userId === me || member === undefined ? [] : [member];
  });
};
