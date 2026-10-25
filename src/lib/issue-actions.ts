import { useQueryClient } from "@tanstack/react-query";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { api, ApiError } from "~/lib/api";
import type { Issue, IssueSummary } from "~/lib/api-types";
import { deselect } from "~/lib/issue-selection";
import { notifyError, notifyWithAction } from "~/lib/notify";
import { queueIssueRequest } from "~/lib/use-update-issue";

type IssueData = Issue | IssueSummary[] | InfiniteData<IssueSummary[]>;

const without = (data: IssueData | undefined, ids: Set<string>) => {
  const keep = (issue: IssueSummary) => !ids.has(issue.id);

  if (data === undefined || Array.isArray(data)) {
    return data?.filter(keep);
  }

  return "pages" in data
    ? { ...data, pages: data.pages.map((page) => page.filter(keep)) }
    : data;
};

const readded = (
  list: IssueSummary[],
  before: IssueSummary[],
  ids: Set<string>
) => {
  const present = new Set(list.map((issue) => issue.id));

  return [
    ...list,
    ...before.filter((issue) => ids.has(issue.id) && !present.has(issue.id)),
  ];
};

const withRows = (
  data: IssueData | undefined,
  before: IssueData | undefined,
  ids: Set<string>
): IssueData | undefined => {
  if (Array.isArray(data) && Array.isArray(before)) {
    return readded(data, before, ids);
  }

  if (
    data !== undefined &&
    before !== undefined &&
    "pages" in data &&
    "pages" in before
  ) {
    return {
      ...data,
      pages: data.pages.map((page, index) =>
        readded(page, before.pages[index] ?? [], ids)
      ),
    };
  }

  return data;
};

const describe = (issues: IssueSummary[]) =>
  issues.length === 1 ? (issues[0]?.key ?? "") : `${issues.length} issues`;

const projectsOf = (issues: IssueSummary[]) => [
  ...new Set(issues.map((issue) => issue.projectId)),
];

const settleAll = async (
  queryClient: QueryClient,
  issues: IssueSummary[],
  path: (issue: IssueSummary) => string,
  method: "DELETE" | "POST"
) => {
  const results = await Promise.allSettled(
    issues.map(
      async (issue) =>
        await queueIssueRequest(
          queryClient,
          issue,
          async () => await api<Issue>(path(issue), { method })
        )
    )
  );

  return {
    changed: results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    ),
    failed: results.flatMap((result, index) =>
      result.status === "rejected" &&
      !(result.reason instanceof ApiError && result.reason.code === "deleted")
        ? [
            {
              error: v.is(v.instance(Error), result.reason)
                ? result.reason
                : new Error("Request failed"),
              issue: issues[index],
            },
          ]
        : []
    ),
  };
};

const report = (
  verb: string,
  failed: { error: Error; issue: IssueSummary | undefined }[]
) => {
  const [first] = failed;

  if (first !== undefined) {
    notifyError(
      `Could not ${verb} ${describe(failed.flatMap(({ issue }) => issue ?? []))}`
    )(first.error);
  }
};

const refresh = async (queryClient: QueryClient, issues: IssueSummary[]) => {
  await Promise.all(
    projectsOf(issues).map(async (projectId) => {
      await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    })
  );
};

export const restoreIssues = async (
  queryClient: QueryClient,
  issues: IssueSummary[]
) => {
  const { failed } = await settleAll(
    queryClient,
    issues,
    (issue) => `/issues/${issue.key}/restore`,
    "POST"
  );

  report("restore", failed);
  await refresh(queryClient, issues);
};

export const deleteIssues = async (
  queryClient: QueryClient,
  issues: IssueSummary[]
) => {
  const ids = new Set(issues.map((issue) => issue.id));

  deselect(ids);

  const snapshot: [QueryKey, IssueData | undefined][] = [];

  await Promise.all(
    projectsOf(issues).map(async (projectId) => {
      const queryKey = ["issues", projectId];

      await queryClient.cancelQueries({ queryKey });
      snapshot.push(...queryClient.getQueriesData<IssueData>({ queryKey }));
      queryClient.setQueriesData<IssueData>({ queryKey }, (data) =>
        without(data, ids)
      );
    })
  );

  const { changed, failed } = await settleAll(
    queryClient,
    issues,
    (issue) => `/issues/${issue.key}`,
    "DELETE"
  );

  if (changed.length > 0) {
    notifyWithAction({
      action: "Undo",
      onAction: () => {
        void restoreIssues(queryClient, changed);
      },
      title: `Deleted ${describe(changed)}`,
    });
  }

  const unremoved = new Set(failed.flatMap(({ issue }) => issue?.id ?? []));

  for (const [queryKey, before] of snapshot) {
    queryClient.setQueryData<IssueData>(queryKey, (data) =>
      withRows(data, before, unremoved)
    );
  }

  report("delete", failed);
  await refresh(queryClient, issues);
};

export const useDeleteIssue = () => {
  const queryClient = useQueryClient();

  return {
    remove: async (issues: IssueSummary[]) => {
      await deleteIssues(queryClient, issues);
    },
    restore: async (issues: IssueSummary[]) => {
      await restoreIssues(queryClient, issues);
    },
  };
};
