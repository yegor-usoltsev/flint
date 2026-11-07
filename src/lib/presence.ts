import { queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { request, useMe } from "~/lib/api";
import type { Member, Presence, RealtimeEvent } from "~/lib/api-types";
import { endpointPath } from "~/lib/endpoints";
import { membersQuery } from "~/lib/queries";

const heartbeatMs = 25_000;

const events = new Map<string, number>();

const fetchPresence = async (slug: string): Promise<Presence[]> => {
  const seen = events.get(slug);

  const presence = await request("GET /workspaces/:slug/presence", {
    params: { slug },
  });

  return events.get(slug) === seen ? presence : await fetchPresence(slug);
};

export const presenceQuery = (slug: string) =>
  queryOptions({
    queryFn: async () => await fetchPresence(slug),
    queryKey: ["workspaces", slug, "presence"],
    staleTime: Number.POSITIVE_INFINITY,
  });

export const applyPresence = (
  queryClient: QueryClient,
  slug: string,
  event: RealtimeEvent
) => {
  events.set(slug, (events.get(slug) ?? 0) + 1);
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

const changed = new Set<string>();
let flush: ReturnType<typeof setTimeout> | null = null;

const reportSoon = (slug: string) => {
  changed.add(slug);
  flush ??= setTimeout(() => {
    flush = null;

    for (const item of changed) {
      report(item);
    }

    changed.clear();
  }, 0);
};

const beat = () => {
  if (document.visibilityState === "visible") {
    for (const slug of viewed.keys()) {
      report(slug);
    }
  }
};

const leaveAll = () => {
  clearTimeout(flush ?? undefined);
  flush = null;

  for (const slug of new Set([...viewed.keys(), ...changed])) {
    send(slug, []);
  }

  changed.clear();
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

export const viewTarget = (slug: string, targetId: string) => {
  const targets = viewed.get(slug) ?? new Map<string, number>();
  const count = targets.get(targetId) ?? 0;

  targets.set(targetId, count + 1);
  viewed.set(slug, targets);

  if (timer === null) {
    start();
  }

  if (count === 0 && document.visibilityState === "visible") {
    reportSoon(slug);
  }

  return () => {
    const left = (targets.get(targetId) ?? 1) - 1;

    if (left > 0) {
      targets.set(targetId, left);

      return;
    }

    targets.delete(targetId);
    reportSoon(slug);

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

  useEffect(() => viewTarget(slug, targetId), [slug, targetId]);

  const userIds =
    presence?.find((item) => item.targetId === targetId)?.userIds ?? [];

  return userIds.flatMap((userId): Member[] => {
    const member = members?.find((item) => item.userId === userId);

    return userId === me || member === undefined ? [] : [member];
  });
};
