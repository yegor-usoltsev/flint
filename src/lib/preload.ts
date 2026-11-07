import type { QueryClient } from "@tanstack/react-query";

import { api, meQuery } from "~/lib/api";
import type { IssueSummary } from "~/lib/api-types";
import { prefetchDiagrams } from "~/lib/mermaid";
import {
  assignedIssuesQuery,
  issueQuery,
  issuesQuery,
  prefetchIssue,
  projectQuery,
  projectsQuery,
  timelineQuery,
} from "~/lib/queries";
import { wikiPageQuery, wikiPagesQuery, workspaceWiki } from "~/lib/wiki";

export interface RouterContext {
  queryClient: QueryClient;
}

export const preload = async (load: () => Promise<void>) => {
  if (typeof window !== "undefined") {
    await load().catch(() => null);
  }
};

export const loadIssueDetail = async () =>
  await import("~/components/issue-detail");

export const loadProject = async (
  queryClient: QueryClient,
  key: string,
  issueKey?: string
) => {
  const booting =
    queryClient.getQueryData(meQuery.queryKey) === undefined &&
    queryClient.getQueryData(projectQuery(key).queryKey) === undefined;

  const early = booting ? api<IssueSummary[]>(`/projects/${key}/issues`) : null;

  early?.catch(() => null);

  const project = await queryClient.query({
    ...projectQuery(key),
    staleTime: "static",
  });

  if (issueKey !== undefined) {
    void queryClient.query(issueQuery(project.id, issueKey)).catch(() => null);
  }

  if (early !== null) {
    queryClient.setQueryData(issuesQuery(project).queryKey, await early);
  }

  const issues = await queryClient.query({
    ...issuesQuery(project),
    staleTime: "static",
  });

  const shown = issues.find((issue) => issue.key === issueKey);

  if (shown !== undefined) {
    void prefetchIssue(queryClient, shown);
  }
};

const loadTimeline = async (
  queryClient: QueryClient,
  issue: Pick<IssueSummary, "id" | "key">
) => {
  const { comments } = await queryClient.query({
    ...timelineQuery(issue),
    staleTime: "static",
  });

  await Promise.all(
    comments.map(async (comment) => {
      await prefetchDiagrams(queryClient, comment.body);
    })
  );
};

export const loadIssue = async (queryClient: QueryClient, key: string) => {
  const project = await queryClient.query({
    ...projectQuery(key.split("-")[0] ?? ""),
    staleTime: "static",
  });

  const issue = await queryClient.query({
    ...issueQuery(project.id, key),
    staleTime: "static",
  });

  // Activity loads beside the page instead of holding the navigation.
  void loadTimeline(queryClient, issue).catch(() => null);

  await prefetchDiagrams(queryClient, issue.description);
};

export const loadMyIssues = async (queryClient: QueryClient, slug: string) => {
  const [projects, me] = await Promise.all([
    queryClient.query({ ...projectsQuery(slug), staleTime: "static" }),
    queryClient.query({ ...meQuery, staleTime: "static" }),
  ]);

  if (me === null) {
    return;
  }

  await Promise.all(
    projects.flatMap((project) => [
      queryClient.query({ ...projectQuery(project.key), staleTime: "static" }),
      queryClient.query({
        ...assignedIssuesQuery(project, me.id),
        staleTime: "static",
      }),
    ])
  );
};

export const loadWiki = async (
  queryClient: QueryClient,
  slug: string,
  path: string
) => {
  const me = await queryClient.query({ ...meQuery, staleTime: "static" });
  const workspace = me?.workspaces.find((item) => item.slug === slug);

  if (workspace !== undefined) {
    const wiki = workspaceWiki(workspace);

    const [, page] = await Promise.all([
      queryClient.query({ ...wikiPagesQuery(wiki), staleTime: "static" }),
      path === ""
        ? null
        : queryClient.query({
            ...wikiPageQuery(
              wiki,
              path.toLowerCase().split("/").filter(Boolean).join("/")
            ),
            staleTime: "static",
          }),
    ]);

    if (page !== null) {
      await prefetchDiagrams(queryClient, page.body);
    }
  }
};
