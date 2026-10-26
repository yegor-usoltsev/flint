import type { QueryClient } from "@tanstack/react-query";

import { meQuery } from "~/lib/api";
import {
  assignedIssuesQuery,
  issueQuery,
  issuesQuery,
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

export const loadProject = async (queryClient: QueryClient, key: string) => {
  const project = await queryClient.query({
    ...projectQuery(key),
    staleTime: "static",
  });

  await queryClient.query({ ...issuesQuery(project), staleTime: "static" });
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
  void queryClient
    .query({ ...timelineQuery(issue), staleTime: "static" })
    .catch(() => null);
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

    await Promise.all([
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
  }
};
