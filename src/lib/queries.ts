import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { api, request } from "~/lib/api";
import type {
  Comment,
  Issue,
  IssueEvent,
  IssueSummary,
  Project,
  ProjectDetail,
} from "~/lib/api-types";
import { filterKeys } from "~/lib/issue-view";
import type { IssueSearch } from "~/lib/issue-view";

export const projectsQuery = (slug: string) =>
  queryOptions({
    queryFn: async () =>
      await request("GET /workspaces/:slug/projects", { params: { slug } }),
    queryKey: ["workspaces", slug, "projects"],
  });

export const projectQuery = (key: string) =>
  queryOptions({
    queryFn: async () => await api<ProjectDetail>(`/projects/${key}`),
    queryKey: ["projects", key],
  });

export const membersQuery = (slug: string) =>
  queryOptions({
    queryFn: async () =>
      await request("GET /workspaces/:slug/members", { params: { slug } }),
    queryKey: ["workspaces", slug, "members"],
  });

export const tokensQuery = queryOptions({
  queryFn: async () => await request("GET /me/tokens"),
  queryKey: ["tokens"],
});

export const labelsQuery = (slug: string) =>
  queryOptions({
    queryFn: async () =>
      await request("GET /workspaces/:slug/labels", { params: { slug } }),
    queryKey: ["workspaces", slug, "labels"],
  });

export const trashQuery = (slug: string) =>
  queryOptions({
    queryFn: async () =>
      await request("GET /workspaces/:slug/trash", { params: { slug } }),
    queryKey: ["workspaces", slug, "trash"],
  });

export const issuesQuery = (project: Project) =>
  queryOptions({
    queryFn: async () =>
      await api<IssueSummary[]>(`/projects/${project.key}/issues`),
    queryKey: ["issues", project.id],
  });

const closedPage = 50;

export const closedIssuesQuery = (project: Project, search: IssueSearch) => {
  const filters = filterKeys.flatMap((key) =>
    (search[key] ?? []).map((value) => [key, String(value)])
  );

  return infiniteQueryOptions({
    getNextPageParam: (last: IssueSummary[], pages) =>
      last.length < closedPage ? undefined : pages.length * closedPage,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      await api<IssueSummary[]>(
        `/projects/${project.key}/issues?${new URLSearchParams([
          ["closed", "true"],
          ["limit", String(closedPage)],
          ["offset", String(pageParam)],
          ...filters,
        ]).toString()}`
      ),
    queryKey: ["issues", project.id, "closed", filters],
  });
};

export const issueCountsQuery = (project: Project, search: IssueSearch) => {
  const query = {
    assignee: search.assignee,
    label: search.label,
    priority: search.priority,
    status: search.status,
  };

  return queryOptions({
    queryFn: async () =>
      await request("GET /projects/:key/issue-counts", {
        params: { key: project.key },
        query,
      }),
    queryKey: ["issues", project.id, "counts", query],
  });
};

export const issueQuery = (projectId: string, key: string) =>
  queryOptions({
    queryFn: async () => await api<Issue>(`/issues/${key}`),
    queryKey: ["issues", projectId, "detail", key.toUpperCase()],
  });

export const timelineQuery = (issue: Pick<IssueSummary, "id" | "key">) =>
  queryOptions({
    queryFn: async () => {
      const [comments, events] = await Promise.all([
        api<Comment[]>(`/issues/${issue.key}/comments`),
        api<IssueEvent[]>(`/issues/${issue.key}/activity`),
      ]);

      return { comments, events };
    },
    queryKey: ["timeline", issue.id],
  });
