import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { FileTextIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { StatusIcon } from "~/components/status-icon";
import { isNotFound } from "~/lib/api";
import { findIssueByKey } from "~/lib/issue-focus";
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

// A chip shows the cached row at once and keeps its own detail query, which SSE events refresh; it never writes to the document.
export const useMentionedIssue = (key: string) => {
  const workspace = useWorkspace();
  const prefix = key.split("-")[0] ?? "";

  const project = useQuery(projectsQuery(workspace.slug)).data?.find(
    (item) => item.key === prefix
  );

  const cached = useCachedIssueByKey(key);

  const detail = useQuery({
    ...issueQuery(project?.id ?? "", key),
    enabled: project !== undefined,
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

const IssueChip = ({ node }: ReactNodeViewProps) => {
  const workspace = useWorkspace();
  const key = String(node.attrs["key"] ?? "");
  const { issue, missing, status } = useMentionedIssue(key);

  return (
    <NodeViewWrapper as="span">
      {missing ? (
        key
      ) : (
        <Link
          className="mention"
          data-mention=""
          draggable={false}
          params={{ issueKey: key, slug: workspace.slug }}
          to="/$slug/issue/$issueKey"
        >
          <span className="shrink-0 whitespace-nowrap">
            {status === undefined ? null : (
              <StatusIcon category={status.category} color={status.color} />
            )}
            <span className="text-muted-foreground">{key}</span>
          </span>
          {issue === null ? null : (
            <span className="truncate">{issue.title}</span>
          )}
        </Link>
      )}
    </NodeViewWrapper>
  );
};

const PageChip = ({ node }: ReactNodeViewProps) => {
  const workspace = useWorkspace();
  const href = String(node.attrs["href"] ?? "");
  const label = String(node.attrs["label"] ?? "");
  const id = docPath.exec(href)?.groups?.["id"] ?? "";

  const page = useQuery(wikiPagesQuery(workspaceWiki(workspace))).data?.find(
    (item) => item.id === id
  );

  return (
    <NodeViewWrapper as="span">
      <Link
        className="mention"
        data-mention=""
        draggable={false}
        {...(page === undefined
          ? { params: { pageId: id }, to: "/doc/$pageId" as const }
          : wikiTarget(workspace, page.path))}
      >
        <FileTextIcon />
        <span className="truncate">{page?.title ?? label}</span>
      </Link>
    </NodeViewWrapper>
  );
};

export const issueChipView = ReactNodeViewRenderer(IssueChip, { as: "span" });

export const pageChipView = ReactNodeViewRenderer(PageChip, { as: "span" });
