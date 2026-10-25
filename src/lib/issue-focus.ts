import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { MouseEvent } from "react";

import type { Issue, IssueSummary } from "~/lib/api-types";
import {
  extended,
  getSelection,
  hasSelection,
  setSelection,
  toggled,
} from "~/lib/issue-selection";

type IssueData =
  | Issue
  | IssueSummary
  | IssueSummary[]
  | InfiniteData<IssueSummary[]>;

const rowSelector = "[data-issue]";
let contextIssue: IssueSummary | null = null;

const rows = (scope: ParentNode) => [
  ...scope.querySelectorAll<HTMLElement>(rowSelector),
];

const show = (row: HTMLElement | undefined) => {
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
};

const rowById = (id: string) =>
  document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(id)}"]`) ??
  undefined;

const focusWhenShown = (id: string, frames = 60) => {
  requestAnimationFrame(() => {
    const row = rowById(id);

    if (document.activeElement !== document.body) {
      return;
    }

    if (row === undefined) {
      if (frames > 0) {
        focusWhenShown(id, frames - 1);
      }
    } else {
      show(row);
    }
  });
};

export const useContextIssue = (
  issue: IssueSummary | undefined,
  ready = true
) => {
  const current = ready ? (issue ?? null) : null;

  const id = current?.id;

  useEffect(
    () => () => {
      if (id !== undefined) {
        focusWhenShown(id);
      }
    },
    [id]
  );

  useEffect(() => {
    contextIssue = current;

    return () => {
      if (contextIssue === current) {
        contextIssue = null;
      }
    };
  }, [current]);
};

const issuesOf = (data: IssueData | undefined) => {
  if (data === undefined) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  return "pages" in data ? data.pages.flat() : [data];
};

const isDeleted = (issue: IssueSummary) =>
  "deletedAt" in issue && issue.deletedAt !== null;

const findCached = (
  queryClient: QueryClient,
  match: (issue: IssueSummary) => boolean
) => {
  for (const [, data] of queryClient.getQueriesData<IssueData>({
    queryKey: ["issues"],
  })) {
    const issue = issuesOf(data).find(
      (item) => match(item) && !isDeleted(item)
    );

    if (issue !== undefined) {
      return issue;
    }
  }

  return null;
};

export const findIssue = (queryClient: QueryClient, id: string) =>
  findCached(queryClient, (item) => item.id === id);

export const findIssueByKey = (queryClient: QueryClient, key: string) =>
  findCached(queryClient, (item) => item.key === key);

export const useCachedIssue = (issue: IssueSummary) => {
  const queryClient = useQueryClient();

  return useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => findIssue(queryClient, issue.id) ?? issue
  );
};

export const cachedIssues = (
  queryClient: QueryClient,
  issues: IssueSummary[]
) => issues.flatMap((issue) => findIssue(queryClient, issue.id) ?? []);

export const useCachedIssues = (issues: IssueSummary[]) => {
  const queryClient = useQueryClient();
  const last = useRef<IssueSummary[]>([]);

  return useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => {
      const next = cachedIssues(queryClient, issues);

      if (
        next.length !== last.current.length ||
        next.some((issue, index) => issue !== last.current[index])
      ) {
        last.current = next;
      }

      return last.current;
    }
  );
};

const focusedRow = () =>
  document.activeElement?.closest<HTMLElement>(rowSelector) ?? null;

export const focusedId = () => focusedRow()?.dataset["issue"] ?? null;

export const rowOrder = () =>
  rows(document).flatMap((row) => row.dataset["issue"] ?? []);

export const targetIssue = (queryClient: QueryClient) => {
  const id = focusedId();
  const issue = id === null ? null : findIssue(queryClient, id);

  return issue ?? contextIssue;
};

let closeMenu: (() => void) | null = null;

export const setMenuCloser = (close: (() => void) | null) => {
  closeMenu = close;
};

export const closeIssueMenu = () => {
  closeMenu?.();
};

export const selectedIssues = (queryClient: QueryClient) => {
  const order = rowOrder();
  const position = (id: string) => order.indexOf(id) + 1 || order.length + 1;

  return [...getSelection().ids]
    .toSorted((a, b) => position(a) - position(b))
    .flatMap((id) => findIssue(queryClient, id) ?? []);
};

export const targetIssues = (queryClient: QueryClient) => {
  const selected = selectedIssues(queryClient);

  if (selected.length > 0) {
    return selected;
  }

  const issue = targetIssue(queryClient);

  return issue === null ? [] : [issue];
};

export const hasRows = () => document.querySelector(rowSelector) !== null;

export const onBoard = () => document.querySelector("[data-board]") !== null;

export const moveFocus = (step: 1 | -1) => {
  const current = focusedRow();
  const column = current?.closest("[data-board] section");
  const list = rows(column ?? document);

  show(current === null ? list[0] : list[list.indexOf(current) + step]);
};

export const moveColumn = (step: 1 | -1) => {
  const columns = [...document.querySelectorAll("[data-board] section")].filter(
    (section) => section.querySelector(rowSelector) !== null
  );

  const current = focusedRow();
  const column = current?.closest("section");

  const index = columns.indexOf(column ?? document.body);
  const next = columns[index === -1 ? 0 : index + step];

  if (next !== undefined) {
    const list = rows(next);

    const position =
      current === null || !column ? 0 : rows(column).indexOf(current);

    show(list[Math.min(position, list.length - 1)]);
  }
};

export const rowToRefocus = (id: string, index: number) => {
  const list = rows(document);

  return rowById(id) ?? list[Math.min(index, list.length - 1)];
};

const restoreRow = (id: string, index: number) => {
  if (document.activeElement === document.body) {
    show(rowToRefocus(id, index));
  }
};

export const focusedIndex = () => {
  const row = focusedRow();

  return row === null ? -1 : rows(document).indexOf(row);
};

export const refocusRow = (id: string, index = -1) => {
  requestAnimationFrame(() => {
    restoreRow(id, index);
  });
};

export const keepRowFocus = (frames = 30) => {
  const row = focusedRow();
  const id = row?.dataset["issue"];

  if (row === null || id === undefined) {
    return;
  }

  const index = rows(document).indexOf(row);

  const check = (left: number) => {
    requestAnimationFrame(() => {
      if (!row.isConnected) {
        restoreRow(id, index);
      } else if (left > 0) {
        check(left - 1);
      }
    });
  };

  check(frames);
};

export const focusNeighbour = () => {
  const current = focusedRow();

  if (current !== null) {
    const list = rows(document);
    const index = list.indexOf(current);

    show(list[index + 1] ?? list[index - 1]);
  }
};

export const blurRow = () => {
  // oxlint-disable-next-line github/no-blur -- Escape clears the row focus; no earlier element should take it.
  focusedRow()?.blur();
};

export const useHoverFocus = () => {
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons !== 0) {
        return;
      }

      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(rowSelector)
          : null;

      const active = document.activeElement;

      if (
        row !== null &&
        row !== active &&
        (active === document.body || active?.closest(rowSelector) !== null)
      ) {
        row.focus({ focusVisible: false, preventScroll: true });
      }
    };

    document.addEventListener("pointermove", onPointerMove);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, []);
};

const isTouch = (event: Event) =>
  event instanceof PointerEvent
    ? event.pointerType === "touch"
    : window.matchMedia("(pointer: coarse)").matches;

export const toggleRow = (event: MouseEvent, id: string) => {
  event.preventDefault();
  event.stopPropagation();
  setSelection(
    event.shiftKey
      ? extended(getSelection(), rowOrder(), focusedId() ?? id, id)
      : toggled(getSelection(), id)
  );
};

export const selectByClick = (event: MouseEvent, id: string) => {
  const modified = event.shiftKey || event.metaKey || event.ctrlKey;

  const selecting = modified || (hasSelection() && isTouch(event.nativeEvent));

  if (selecting) {
    toggleRow(event, id);
  }

  return selecting;
};
