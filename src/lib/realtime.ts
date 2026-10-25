import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { createContext, use, useEffect, useState } from "react";

import { meQuery } from "~/lib/api";
import type { RealtimeEvent } from "~/lib/api-types";
import { hasPendingIssueWrites } from "~/lib/use-update-issue";

export const eventKeys = (slug: string, event: RealtimeEvent) =>
  ({
    attachment: [["attachments"]],
    comment: [["timeline", event.issueId]],
    issue: [
      ["issues", event.projectId],
      ["timeline", event.id],
      ["workspaces", slug, "projects"],
      ["workspaces", slug, "labels"],
      ["workspaces", slug, "trash"],
    ],
    label: [["workspaces", slug, "labels"], ["issues"]],
    member: [["workspaces", slug, "members"], ["me"]],
    project: [
      ["workspaces", slug, "projects"],
      ["projects"],
      ["workspaces", slug, "labels"],
    ],
    wiki: [
      ["wiki", event.projectId ?? slug],
      ["doc", event.id],
      ["workspaces", slug, "trash"],
    ],
    workspace: [["me"], ["workspaces", slug], ["projects"]],
  })[event.entity] satisfies QueryKey[];

export const RealtimeStatus = createContext(true);

export const useRealtimeConnected = () => use(RealtimeStatus);

export const useRealtime = (slug: string) => {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(true);

  // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- connect() replaces the EventSource on retry and when the page shows again; the cleanup closes the current one.
  useEffect(() => {
    const pending = new Map<string, QueryKey>();
    const stale = new Set<string>();
    let source: EventSource | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let flushing = false;

    const later = (run: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, delay);

      timers.add(timer);
    };

    const flush = () => {
      if (hasPendingIssueWrites()) {
        later(flush, 300);

        return;
      }

      flushing = false;

      if (stale.size > 0) {
        const hashes = new Set(stale);

        stale.clear();
        void queryClient.invalidateQueries({
          predicate: (query) => hashes.has(query.queryHash),
        });
      }

      for (const queryKey of pending.values()) {
        void queryClient.invalidateQueries({ queryKey });
      }

      pending.clear();
    };

    const schedule = () => {
      if (!flushing) {
        flushing = true;
        later(flush, 150);
      }
    };

    const connect = () => {
      if (document.hidden || source !== null) {
        return;
      }

      const next = new EventSource(`/api/v1/workspaces/${slug}/stream`);

      source = next;
      next.addEventListener("open", () => {
        setConnected(true);

        for (const query of queryClient.getQueryCache().getAll()) {
          stale.add(query.queryHash);
        }

        schedule();
      });

      next.addEventListener("error", () => {
        setConnected(false);
        void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });

        if (next.readyState === EventSource.CLOSED) {
          source = null;
          later(connect, 3000);
        }
      });

      next.addEventListener("message", (message: MessageEvent<string>) => {
        // SAFETY: the stream sends RealtimeEvent JSON in every data line.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SSE contract types the payload.
        const event = JSON.parse(message.data) as RealtimeEvent;

        for (const queryKey of eventKeys(slug, event)) {
          pending.set(JSON.stringify(queryKey), queryKey);
        }

        schedule();
      });
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        source?.close();
        source = null;
      } else {
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      source?.close();

      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [queryClient, slug]);

  return connected;
};
