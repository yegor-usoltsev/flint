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
const listMax = 1440;
const panelMaxShare = 0.65;
const defaultShare = 0.42;
const splitByDefault = 1800;
const openKey = "flint:issue-panel";
const widthKey = "flint:issue-panel-width";

export type PanelScope = "list" | "wiki";

interface PanelState {
  available: boolean;
  fits: boolean;
  issue: string | null;
  open: boolean;
  picked: boolean;
  scope: PanelScope;
  width: number | null;
}

let state: PanelState = {
  available: false,
  fits: false,
  issue: null,
  open: false,
  picked: false,
  scope: "list",
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
  const open = localStorage.getItem(openKey);

  state = {
    ...state,
    open: open === null ? window.innerWidth >= splitByDefault : open === "true",
    width: Number.isFinite(width) && width > 0 ? width : null,
  };
};

const update = (patch: Partial<PanelState>) => {
  load();

  const next = { ...state, ...patch };

  const sameView =
    next.available === state.available &&
    next.fits === state.fits &&
    next.issue === state.issue &&
    next.open === state.open;

  const sameLayout =
    next.picked === state.picked &&
    next.scope === state.scope &&
    next.width === state.width;

  if (sameView && sameLayout) {
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
  fits: false,
  issue: null,
  open: false,
  picked: false,
  scope: "list",
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

export const usePanelFits = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot().fits,
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

export const clampWidth = (
  width: number | null,
  space: number,
  capList = true
) =>
  Math.round(
    Math.min(
      Math.max(
        width ?? Math.max(space * defaultShare, capList ? space - listMax : 0),
        panelMin
      ),
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

export const setPanelSpace = (space: number, enabled: boolean) => {
  const fits = space >= panelMin + listMin;

  update({ available: enabled && fits, fits });
};

let workspace: string | null = null;

export const syncPanelIssue = (
  issue: string | null,
  slug: string,
  scope: PanelScope
) => {
  if (slug !== workspace || scope !== snapshot().scope) {
    workspace = slug;
    update({ issue, picked: false, scope });
  } else if (issue !== null && issue !== snapshot().issue) {
    update({ issue, picked: false });
  }
};

export const writePanelUrl = () => {
  const url = new URL(window.location.href);
  const { issue, open } = snapshot();
  const key = open ? issue : null;

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
  writePanelUrl();
};

export const openPanel = (key: string | null) => {
  if (!panelAvailable()) {
    return false;
  }

  setOpen(true);

  if (key !== null && key !== panelIssue()) {
    update({ issue: key, picked: false });
    writePanelUrl();
  } else if (key !== null) {
    update({ picked: false });
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

export const panelVisible = (current: PanelState) =>
  current.open && current.available && current.issue !== null;

export const togglePanel = (queryClient: QueryClient) => {
  if (panelVisible(snapshot())) {
    closePanel();

    return;
  }

  openPanel(
    issueKeyOfRow(queryClient, focusedId() ?? undefined) ??
      panelIssue() ??
      issueKeyOfRow(queryClient, rowOrder()[0])
  );
};

const savedKey = (key: string | null) =>
  key !== null && /-\d+$/u.test(key) ? key : null;

export const showFirstRow = (queryClient: QueryClient) => {
  const key =
    savedKey(issueKeyOfRow(queryClient, focusedId() ?? undefined)) ??
    rowOrder()
      .map((id) => savedKey(issueKeyOfRow(queryClient, id)))
      .find((found) => found !== null) ??
    null;

  if (key === null) {
    return false;
  }

  update({ issue: key, picked: true });
  writePanelUrl();

  return true;
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
