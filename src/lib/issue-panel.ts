import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { MouseEvent } from "react";

import {
  findIssue,
  findIssueByKey,
  focusedId,
  hasRows,
  moveFocus,
  rowOrder,
} from "~/lib/issue-focus";

export const panelMin = 420;
export const listMin = 520;
const panelMaxShare = 0.65;
const defaultShare = 0.42;
const openKey = "flint:issue-panel";
const widthKey = "flint:issue-panel-width";

interface PanelState {
  available: boolean;
  issue: string | null;
  open: boolean;
  width: number | null;
}

let state: PanelState = {
  available: false,
  issue: null,
  open: false,
  width: null,
};

let loaded = false;
const listeners = new Set<() => void>();

const load = () => {
  if (loaded || typeof window === "undefined") {
    return;
  }

  loaded = true;

  const width = Number(localStorage.getItem(widthKey));

  state = {
    ...state,
    open: localStorage.getItem(openKey) === "true",
    width: Number.isFinite(width) && width > 0 ? width : null,
  };
};

const update = (patch: Partial<PanelState>) => {
  load();

  const next = { ...state, ...patch };

  if (
    next.available === state.available &&
    next.issue === state.issue &&
    next.open === state.open &&
    next.width === state.width
  ) {
    return;
  }

  state = next;

  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => {
  load();

  return state;
};

const serverState: PanelState = {
  available: false,
  issue: null,
  open: false,
  width: null,
};

export const usePanel = () =>
  useSyncExternalStore(subscribe, snapshot, () => serverState);

export const usePanelOpen = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot().open,
    () => false
  );

export const usePanelShows = (key: string) =>
  useSyncExternalStore(
    subscribe,
    () => {
      const current = snapshot();

      return current.open && current.available && current.issue === key;
    },
    () => false
  );

export const panelShown = () => {
  const current = snapshot();

  return current.open && current.available;
};

export const panelAvailable = () => snapshot().available;

export const panelIssue = () => snapshot().issue;

export const clampWidth = (width: number | null, space: number) =>
  Math.round(
    Math.min(
      Math.max(width ?? space * defaultShare, panelMin),
      Math.max(panelMin, Math.min(space * panelMaxShare, space - listMin))
    )
  );

export const setPanelWidth = (width: number | null) => {
  if (width === null) {
    localStorage.removeItem(widthKey);
  } else {
    localStorage.setItem(widthKey, String(width));
  }

  update({ width });
};

export const setPanelAvailable = (available: boolean) => {
  update({ available });
};

let workspace: string | null = null;

export const syncPanelIssue = (issue: string | null, slug: string) => {
  if (slug !== workspace) {
    workspace = slug;
    update({ issue });
  } else if (issue !== null) {
    update({ issue });
  }
};

export const writePanelUrl = () => {
  const url = new URL(window.location.href);
  const key = panelIssue();

  if (key === null) {
    url.searchParams.delete("issue");
  } else {
    url.searchParams.set("issue", key);
  }

  if (url.href !== window.location.href) {
    History.prototype.replaceState.call(
      window.history,
      window.history.state,
      "",
      url
    );
  }
};

const setOpen = (open: boolean) => {
  localStorage.setItem(openKey, String(open));
  update({ open });
};

export const openPanel = (key: string | null) => {
  if (!panelAvailable()) {
    return false;
  }

  setOpen(true);

  if (key !== null && key !== panelIssue()) {
    update({ issue: key });
    writePanelUrl();
  }

  return true;
};

export const closePanel = () => {
  setOpen(false);
};

export const peekIssue = (key: string) => {
  if (panelShown() && panelIssue() === key) {
    closePanel();

    return true;
  }

  return openPanel(key);
};

export const showInPanel = (key: string) => panelShown() && openPanel(key);

const issueKeyOfRow = (queryClient: QueryClient, id: string | undefined) =>
  id === undefined ? null : (findIssue(queryClient, id)?.key ?? null);

export const togglePanel = (queryClient: QueryClient) => {
  if (panelShown()) {
    closePanel();

    return;
  }

  openPanel(
    issueKeyOfRow(queryClient, focusedId() ?? undefined) ??
      panelIssue() ??
      issueKeyOfRow(queryClient, rowOrder()[0])
  );
};

export const peekFocused = (queryClient: QueryClient) => {
  const key = issueKeyOfRow(queryClient, focusedId() ?? undefined);

  if (key !== null) {
    peekIssue(key);
  }
};

export const focusPanelRow = (queryClient: QueryClient) => {
  const key = panelIssue();
  const issue = key === null ? null : findIssueByKey(queryClient, key);

  const row =
    issue === null
      ? null
      : document.querySelector<HTMLElement>(
          `[data-issue="${CSS.escape(issue.id)}"]`
        );

  row?.focus({ preventScroll: true });

  return row !== null;
};

export const returnFocusToList = (queryClient: QueryClient) => {
  if (focusPanelRow(queryClient)) {
    return;
  }

  if (hasRows()) {
    moveFocus(1);
  } else if (document.activeElement instanceof HTMLElement) {
    // oxlint-disable-next-line github/no-blur -- Escape leaves the panel; no list row exists to take the focus.
    document.activeElement.blur();
  }
};

let follow: ReturnType<typeof setTimeout> | undefined;

export const followFocus = (queryClient: QueryClient) => {
  clearTimeout(follow);

  if (!panelShown()) {
    return;
  }

  follow = setTimeout(() => {
    const key = issueKeyOfRow(queryClient, focusedId() ?? undefined);

    if (key !== null && panelShown()) {
      openPanel(key);
    }
  }, 80);
};

export const interceptIssueClick = (event: MouseEvent, key: string) => {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey;

  if (event.defaultPrevented || event.button !== 0 || modified) {
    return false;
  }

  const handled = event.altKey ? openPanel(key) : showInPanel(key);

  if (handled) {
    event.preventDefault();
  }

  return handled;
};
