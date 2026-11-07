import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createContext, use, useEffect, useState } from "react";

import { meQuery } from "~/lib/api";
import type { RealtimeEvent } from "~/lib/api-types";
import { projectView } from "~/lib/issue-view";
import type { IssueOrigin } from "~/lib/issue-view";
import { subscribeRealtime } from "~/lib/realtime-transport";
import { flashRemote } from "~/lib/remote-flash";
import { animateMoves, rowRects } from "~/lib/remote-move";
import {
  cancelNotices,
  issueSnapshots,
  noticeOffscreen,
} from "~/lib/remote-notice";
import { retryFailedDrafts } from "~/lib/use-draft";
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

export const useRealtime = (slug: string, userId: string | undefined) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const pending = new Map<string, QueryKey>();
    const remote = new Set<string>();
    const actors = new Map<string, Set<string>>();
    const stale = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let flushing = false;
    let active = true;

    const origin = (): IssueOrigin | undefined => {
      const { location, matches } = router.state;

      const project = matches.find(
        (match) => match.routeId === "/$slug/project/$key"
      );

      if (project !== undefined) {
        const search = { ...project.search };

        delete search.issue;

        const { key } = project.params;

        return {
          projectKey: key.toUpperCase(),
          search,
          view: projectView(key),
        };
      }

      return matches.some((match) => match.routeId === "/$slug/my-issues")
        ? { view: "mine" }
        : location.state.from;
    };

    const openIssue = (key: string) => {
      void router.navigate({
        params: { issueKey: key, slug },
        state: { from: origin() },
        to: "/$slug/issue/$issueKey",
      });
    };

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

      const changedIssues = new Map(actors);
      const before = issueSnapshots(queryClient, [...changedIssues.keys()]);

      const rects =
        changedIssues.size > 0 ? rowRects() : new Map<string, DOMRect>();

      actors.clear();

      const refreshed = [...pending.values()].map(async (queryKey) => {
        await queryClient.invalidateQueries({ queryKey });
      });

      const changed = [...remote];

      pending.clear();
      remote.clear();

      const flashChanged = async () => {
        await Promise.allSettled(refreshed);

        if (!active) {
          return;
        }

        flashRemote(changed);

        animateMoves(rects);

        noticeOffscreen({
          actors: changedIssues,
          before,
          openIssue,
          queryClient,
          slug,
        });
      };

      void flashChanged();
    };

    const schedule = () => {
      if (!flushing) {
        flushing = true;
        later(flush, 150);
      }
    };

    const unsubscribe =
      userId === undefined
        ? undefined
        : subscribeRealtime(slug, userId, (message) => {
            if (message.type === "open") {
              setConnected(true);
              void retryFailedDrafts();

              for (const query of queryClient.getQueryCache().getAll()) {
                stale.add(query.queryHash);
              }

              schedule();
            } else if (message.type === "error") {
              setConnected(false);
              void queryClient.invalidateQueries({
                queryKey: meQuery.queryKey,
              });
            } else if (message.type === "message") {
              // SAFETY: the stream sends RealtimeEvent JSON in every data line.
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The SSE contract types the payload.
              const event = JSON.parse(message.data) as RealtimeEvent;

              for (const queryKey of eventKeys(slug, event)) {
                pending.set(JSON.stringify(queryKey), queryKey);
              }

              const byOther =
                event.actorId !== undefined && event.actorId !== userId;

              if (
                byOther &&
                (event.entity === "issue" || event.entity === "comment")
              ) {
                remote.add(event.id);
              }

              if (
                byOther &&
                event.entity === "issue" &&
                event.actorId !== undefined
              ) {
                actors.set(
                  event.id,
                  (actors.get(event.id) ?? new Set()).add(event.actorId)
                );
              }

              schedule();
            }
          });

    const online = () => {
      void retryFailedDrafts();
    };

    window.addEventListener("online", online);

    return () => {
      active = false;
      cancelNotices();
      window.removeEventListener("online", online);
      unsubscribe?.();

      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [queryClient, router, slug, userId]);

  return connected;
};
