import type { QueryClient } from "@tanstack/react-query";

import { findIssue } from "~/lib/issue-focus";
import { notifyWithAction } from "~/lib/notify";
import { membersQuery, projectQuery } from "~/lib/queries";

const headerHeight = 44;

const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(id)}"]`);

const offscreen = (row: HTMLElement) => {
  const { bottom, top } = row.getBoundingClientRect();

  return top < headerHeight || bottom > window.innerHeight;
};

export const issueStatuses = (queryClient: QueryClient, ids: string[]) =>
  new Map(ids.map((id) => [id, findIssue(queryClient, id)?.statusId]));

export const noticeOffscreen = ({
  actors,
  before,
  queryClient,
  slug,
}: {
  actors: Map<string, string>;
  before: Map<string, string | undefined>;
  queryClient: QueryClient;
  slug: string;
}) => {
  const hidden = [...actors.keys()].flatMap((id) => {
    const row = rowOf(id);
    const issue = findIssue(queryClient, id) ?? null;

    if (row === null || issue === null) {
      return [];
    }

    return offscreen(row) ? [{ id, issue, row }] : [];
  });

  const [first] = hidden;

  if (first === undefined) {
    return;
  }

  const actorId = actors.get(first.id);

  const actor =
    queryClient
      .getQueryData(membersQuery(slug).queryKey)
      ?.find((member) => member.userId === actorId)?.displayName ??
    "A teammate";

  const status = queryClient
    .getQueryData(projectQuery(first.issue.key.split("-")[0] ?? "").queryKey)
    ?.statuses.find((item) => item.id === first.issue.statusId);

  const moved =
    status !== undefined && before.get(first.id) !== first.issue.statusId;

  let title = `${actor} updated ${first.issue.key}`;

  if (hidden.length > 1) {
    title = `${actor} updated ${hidden.length} issues`;
  } else if (moved) {
    title = `${actor} moved ${first.issue.key} to ${status.name}`;
  }

  notifyWithAction({
    action: "Show",
    onAction: () => {
      first.row.scrollIntoView({ behavior: "smooth", block: "center" });
      first.row.focus({ preventScroll: true });
    },
    title,
  });
};
