import { useQueries, useQuery } from "@tanstack/react-query";

import { useMe } from "~/lib/api";
import type { IssueSummary, Status } from "~/lib/api-types";
import { byClosed, isClosedStatus } from "~/lib/issue-view";
import { issuesQuery, projectQuery, projectsQuery } from "~/lib/queries";

const priorityRank = (issue: IssueSummary) =>
  issue.priority === 0 ? 5 : issue.priority;

const byPriority = (a: IssueSummary, b: IssueSummary) =>
  priorityRank(a) - priorityRank(b) || b.updatedAt.localeCompare(a.updatedAt);

const groupByStatus = (
  issues: IssueSummary[],
  statuses: Map<string, Status>
) => {
  const groups = new Map<string, { issues: IssueSummary[]; status: Status }>();

  for (const issue of issues.toSorted(byPriority)) {
    const status = statuses.get(issue.statusId);

    if (status !== undefined) {
      const group = groups.get(status.name) ?? { issues: [], status };

      group.issues.push(issue);
      groups.set(status.name, group);
    }
  }

  for (const group of groups.values()) {
    if (isClosedStatus(group.status)) {
      group.issues.sort(byClosed);
    }
  }

  return [...groups.values()].toSorted(
    (a, b) => a.status.position - b.status.position
  );
};

export const useMyIssues = (slug: string, enabled = true) => {
  const meId = useMe().data?.id;
  const projects = useQuery({ ...projectsQuery(slug), enabled });
  const list = enabled ? (projects.data ?? []) : [];

  const details = useQueries({
    queries: list.map((project) => projectQuery(project.key)),
  });

  const lists = useQueries({
    queries: list.map((project) => issuesQuery(project)),
  });

  const queries = [...details, ...lists];

  const statuses = new Map(
    details.flatMap(
      (query) =>
        query.data?.statuses.map((status) => [status.id, status] as const) ?? []
    )
  );

  const mine = lists.flatMap(
    (query) => query.data?.filter((issue) => issue.assigneeId === meId) ?? []
  );

  const groups = groupByStatus(mine, statuses);

  return {
    failed: queries.some((query) => query.isError),
    groups,
    issues: groups.flatMap((group) => group.issues),
    pending: queries.some((query) => query.isPending),
    retry: () => {
      for (const query of queries) {
        if (query.isError) {
          void query.refetch();
        }
      }
    },
    statuses,
  };
};
