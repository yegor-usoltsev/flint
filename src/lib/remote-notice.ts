import type { QueryClient } from "@tanstack/react-query";

import { toast } from "~/components/ui/toast";
import { findShownIssue } from "~/lib/issue-focus";
import { openPanel, panelIssue, panelShown } from "~/lib/issue-panel";
import { filterKeys, setStatusCollapsed } from "~/lib/issue-view";
import { membersQuery, projectQuery } from "~/lib/queries";

const headerHeight = 44;
const settleMs = 1200;

export interface IssueBefore {
  key: string | undefined;
  rendered: boolean;
  statusId: string | undefined;
}

interface Change {
  actorIds: Set<string>;
  before: IssueBefore | undefined;
}

type Hidden =
  | { kind: "collapsed"; statusId: string }
  | { kind: "filtered" }
  | { kind: "gone" }
  | { kind: "offscreen" };

interface Candidate {
  change: Change;
  hidden: Hidden;
  id: string;
}

const pending = new Map<string, Change>();
let timer: ReturnType<typeof setTimeout> | null = null;

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

export const issueSnapshots = (queryClient: QueryClient, ids: string[]) =>
  new Map(
    ids.map((id): [string, IssueBefore] => {
      const issue = findShownIssue(queryClient, id);

      return [
        id,
        {
          key: issue?.key,
          rendered: rowOf(id) !== null,
          statusId: issue?.statusId,
        },
      ];
    })
  );

const collapsedGroup = (statusId: string) => {
  const group = CSS.escape(`group-${statusId}`);

  return (
    (document
      .querySelector(`#${group}`)
      ?.querySelector("[aria-expanded='false']") ?? null) !== null
  );
};

const filtered = () => {
  const params = new URLSearchParams(window.location.search);

  return filterKeys.some((key) => params.has(key));
};

const hiddenBy = (
  queryClient: QueryClient,
  id: string,
  change: Change
): Hidden | null => {
  const row = rowOf(id);

  if (change.before?.rendered !== true) {
    return null;
  }

  if (row !== null) {
    return inView(row) ? null : { kind: "offscreen" };
  }

  const issue = findShownIssue(queryClient, id);

  if (issue === null) {
    return { kind: "gone" };
  }

  if (collapsedGroup(issue.statusId)) {
    return { kind: "collapsed", statusId: issue.statusId };
  }

  return filtered() ? { kind: "filtered" } : { kind: "gone" };
};

const suffixes = {
  collapsed: " (group collapsed)",
  filtered: " (hidden by filters)",
  gone: " (no longer in this view)",
  offscreen: "",
} satisfies Record<Hidden["kind"], string>;

const actorName = (queryClient: QueryClient, slug: string, id: string) =>
  queryClient
    .getQueryData(membersQuery(slug).queryKey)
    ?.find((member) => member.userId === id)?.displayName ?? "A teammate";

const unbroken = (key: string) => key.replace("-", "\u2011");

const message = (
  queryClient: QueryClient,
  slug: string,
  { change, hidden: why, id }: Candidate,
  hidden: Candidate[]
) => {
  const actors = new Set(hidden.flatMap((item) => [...item.change.actorIds]));
  const issue = findShownIssue(queryClient, id);
  const shownKey = issue?.key ?? change.before?.key;
  const key = shownKey === undefined ? undefined : unbroken(shownKey);
  const suffix = hidden.length > 1 ? "" : suffixes[why.kind];

  if (actors.size > 1) {
    return hidden.length > 1
      ? `${hidden.length} issues changed`
      : `${key ?? "An issue"} changed${suffix}`;
  }

  const [actorId = ""] = actors;
  const actor = actorName(queryClient, slug, actorId);

  if (hidden.length > 1) {
    return `${actor} updated ${hidden.length} issues`;
  }

  if (issue === null) {
    return key === undefined
      ? `${actor} updated an issue`
      : `${actor} updated ${key}${suffix}`;
  }

  const status = queryClient
    .getQueryData(projectQuery(issue.key.split("-")[0] ?? "").queryKey)
    ?.statuses.find((item) => item.id === issue.statusId);

  return status !== undefined &&
    change.before?.statusId !== undefined &&
    change.before.statusId !== issue.statusId
    ? `${actor} moved ${unbroken(issue.key)} to ${status.name}${suffix}`
    : `${actor} updated ${unbroken(issue.key)}${suffix}`;
};

const revealRow = (id: string) => {
  const row = rowOf(id);

  row?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "center",
  });
  row?.focus({ preventScroll: true });
};

const openHidden = (
  queryClient: QueryClient,
  { change, id }: Candidate,
  openIssue: (key: string) => void
) => {
  const key = findShownIssue(queryClient, id)?.key ?? change.before?.key;

  if (key !== undefined && !openPanel(key)) {
    openIssue(key);
  }
};

const show = (
  queryClient: QueryClient,
  candidate: Candidate,
  openIssue: (key: string) => void
) => {
  const { hidden, id } = candidate;

  const reveal = () => {
    if (rowOf(id) === null) {
      openHidden(queryClient, candidate, openIssue);
    } else {
      revealRow(id);
    }
  };

  if (hidden.kind === "offscreen") {
    reveal();
  } else if (hidden.kind === "collapsed") {
    setStatusCollapsed(hidden.statusId, false);
    requestAnimationFrame(reveal);
  } else {
    openHidden(queryClient, candidate, openIssue);
  }
};

const flush = (
  queryClient: QueryClient,
  slug: string,
  openIssue: (key: string) => void
) => {
  const open = panelShown() ? panelIssue() : null;

  const hidden = [...pending].flatMap(([id, change]): Candidate[] => {
    const why = hiddenBy(queryClient, id, change);
    const key = findShownIssue(queryClient, id)?.key ?? change.before?.key;

    return why === null || (key !== undefined && key === open)
      ? []
      : [{ change, hidden: why, id }];
  });

  pending.clear();

  const [first] = hidden;

  if (first === undefined) {
    return;
  }

  const id = toast.add({
    actionProps: {
      children: "Show",
      onClick: () => {
        toast.close(id);
        show(queryClient, first, openIssue);
      },
    },
    title: message(queryClient, slug, first, hidden),
  });
};

export const noticeOffscreen = ({
  actors,
  before,
  openIssue,
  queryClient,
  slug,
}: {
  actors: Map<string, Set<string>>;
  before: Map<string, IssueBefore>;
  openIssue: (key: string) => void;
  queryClient: QueryClient;
  slug: string;
}) => {
  if (actors.size === 0) {
    return;
  }

  for (const [id, actorIds] of actors) {
    const earlier = pending.get(id);

    pending.set(id, {
      actorIds: new Set([...(earlier?.actorIds ?? []), ...actorIds]),
      before: earlier === undefined ? before.get(id) : earlier.before,
    });
  }

  timer ??= setTimeout(() => {
    timer = null;
    flush(queryClient, slug, openIssue);
  }, settleMs);
};

export const cancelNotices = () => {
  pending.clear();

  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};
