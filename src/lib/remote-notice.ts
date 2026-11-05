import type { QueryClient } from "@tanstack/react-query";

import { toast } from "~/components/ui/toast";
import { findShownIssue } from "~/lib/issue-focus";
import { membersQuery, projectQuery } from "~/lib/queries";

const headerHeight = 44;
const settleMs = 1200;

interface Change {
  actorId: string;
  before: string | undefined;
}

const pending = new Map<string, Change>();
let timer: ReturnType<typeof setTimeout> | undefined;
let shown: string | null = null;

const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(id)}"]`);

const inside = (rect: DOMRect, bounds: DOMRect) =>
  rect.top >= bounds.top &&
  rect.bottom <= bounds.bottom &&
  rect.left >= bounds.left &&
  rect.right <= bounds.right;

const clips = (element: Element) => {
  const { overflowX, overflowY } = getComputedStyle(element);

  return overflowX !== "visible" || overflowY !== "visible";
};

const inView = (row: HTMLElement) => {
  const rect = row.getBoundingClientRect();

  const viewport = new DOMRect(
    0,
    headerHeight,
    window.innerWidth,
    window.innerHeight - headerHeight
  );

  if (!inside(rect, viewport)) {
    return false;
  }

  for (
    let parent = row.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    if (clips(parent) && !inside(rect, parent.getBoundingClientRect())) {
      return false;
    }
  }

  return true;
};

export const issueStatuses = (queryClient: QueryClient, ids: string[]) =>
  new Map(ids.map((id) => [id, findShownIssue(queryClient, id)?.statusId]));

const actorName = (queryClient: QueryClient, slug: string, id: string) =>
  queryClient
    .getQueryData(membersQuery(slug).queryKey)
    ?.find((member) => member.userId === id)?.displayName ?? "A teammate";

const message = (
  queryClient: QueryClient,
  slug: string,
  [id, change]: [string, Change],
  hidden: [string, Change][]
) => {
  const actors = new Set(hidden.map(([, item]) => item.actorId));
  const issue = findShownIssue(queryClient, id);

  if (actors.size > 1) {
    return `${hidden.length} issues changed`;
  }

  const actor = actorName(queryClient, slug, change.actorId);

  if (hidden.length > 1 || issue === null) {
    return `${actor} updated ${hidden.length} issues`;
  }

  const status = queryClient
    .getQueryData(projectQuery(issue.key.split("-")[0] ?? "").queryKey)
    ?.statuses.find((item) => item.id === issue.statusId);

  return status !== undefined && change.before !== issue.statusId
    ? `${actor} moved ${issue.key} to ${status.name}`
    : `${actor} updated ${issue.key}`;
};

const flush = (queryClient: QueryClient, slug: string) => {
  const hidden = [...pending].filter(([id]) => {
    const row = rowOf(id);

    return row !== null && !inView(row);
  });

  pending.clear();

  const [first] = hidden;

  if (first === undefined) {
    return;
  }

  if (shown !== null) {
    toast.close(shown);
  }

  const id = toast.add({
    actionProps: {
      children: "Show",
      onClick: () => {
        toast.close(id);

        const row = rowOf(first[0]);

        row?.scrollIntoView({ behavior: "smooth", block: "center" });
        row?.focus({ preventScroll: true });
      },
    },
    title: message(queryClient, slug, first, hidden),
  });

  shown = id;
};

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
  for (const [id, actorId] of actors) {
    pending.set(id, {
      actorId,
      before: pending.get(id)?.before ?? before.get(id),
    });
  }

  if (pending.size === 0) {
    return;
  }

  clearTimeout(timer);
  timer = setTimeout(() => {
    flush(queryClient, slug);
  }, settleMs);
};
