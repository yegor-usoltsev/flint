import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { StatusIcon } from "~/components/status-icon";
import { isNotFound } from "~/lib/api";
import { findIssueByKey } from "~/lib/issue-focus";
import { interceptIssueClick } from "~/lib/issue-panel";
import { docPath } from "~/lib/markdown-mentions";
import { issueQuery, projectQuery, projectsQuery } from "~/lib/queries";
import { useWorkspace } from "~/lib/use-workspace";
import { wikiPagesQuery, wikiTarget, workspaceWiki } from "~/lib/wiki";

const useCachedIssueByKey = (key: string) => {
  const queryClient = useQueryClient();

  return useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => findIssueByKey(queryClient, key),
    () => null
  );
};

export const useMentionedIssue = (key: string) => {
  const workspace = useWorkspace();
  const prefix = key.split("-")[0] ?? "";

  const project = useQuery(projectsQuery(workspace.slug)).data?.find(
    (item) => item.key === prefix
  );

  const cached = useCachedIssueByKey(key);

  const detail = useQuery({
    ...issueQuery(project?.id ?? "", key),
    enabled: project !== undefined && cached === null,
    retry: false,
    staleTime: Infinity,
  });

  const statuses = useQuery({
    ...projectQuery(prefix),
    enabled: project !== undefined,
  }).data?.statuses;

  const issue =
    detail.data === undefined ||
    (cached !== null && cached.version > detail.data.version)
      ? cached
      : detail.data;

  return {
    issue,
    missing: detail.error !== null && isNotFound(detail.error),
    status: statuses?.find((item) => item.id === issue?.statusId),
  };
};

export const IssueChip = ({ issueKey: key }: { issueKey: string }) => {
  const workspace = useWorkspace();
  const { issue, missing, status } = useMentionedIssue(key);

  return (
    <span className="whitespace-normal">
      {missing ? (
        key
      ) : (
        <Link
          className="mention"
          data-mention=""
          draggable={false}
          onClick={(event) => {
            interceptIssueClick(event, key);
          }}
          params={{ issueKey: key, slug: workspace.slug }}
          state={(previous) => ({ full: previous.full })}
          to="/$slug/issue/$issueKey"
        >
          <span>
            {status === undefined ? null : (
              <StatusIcon category={status.category} color={status.color} />
            )}
            <span className="text-muted-foreground">{key}</span>
          </span>
          {issue === null ? null : <span>{issue.title}</span>}
        </Link>
      )}
    </span>
  );
};

export const PageChip = ({ href, label }: { href: string; label: string }) => {
  const workspace = useWorkspace();
  const id = docPath.exec(href)?.groups?.["id"] ?? "";

  const page = useQuery(wikiPagesQuery(workspaceWiki(workspace))).data?.find(
    (item) => item.id === id
  );

  return (
    <span className="whitespace-normal">
      <Link
        className="mention"
        data-mention=""
        draggable={false}
        {...(page === undefined
          ? { params: { pageId: id }, to: "/doc/$pageId" as const }
          : wikiTarget(workspace, page.path))}
      >
        <FileTextIcon />
        <span>{page?.title ?? label}</span>
      </Link>
    </span>
  );
};
