import { useEffect, useSyncExternalStore } from "react";

export interface Selection {
  anchor: string | null;
  base: ReadonlySet<string>;
  ids: ReadonlySet<string>;
}

export const emptySelection: Selection = {
  anchor: null,
  base: new Set(),
  ids: new Set(),
};

export const toggled = (selection: Selection, id: string): Selection => {
  const ids = new Set(selection.ids);

  if (!ids.delete(id)) {
    ids.add(id);
  }

  return { anchor: id, base: ids, ids };
};

const between = (order: string[], from: string, to: string) => {
  const start = order.indexOf(from);
  const end = order.indexOf(to);

  if (start === -1 || end === -1) {
    return [to];
  }

  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
};

export const extended = (
  selection: Selection,
  order: string[],
  from: string,
  to: string
): Selection => {
  const anchor = selection.anchor ?? from;

  return {
    anchor,
    base: selection.base,
    ids: new Set([...selection.base, ...between(order, anchor, to)]),
  };
};

export const selectedAll = (order: string[]): Selection => ({
  anchor: order[0] ?? null,
  base: new Set(order),
  ids: new Set(order),
});

export const without = (
  selection: Selection,
  removed: ReadonlySet<string>
): Selection => {
  const keep = (ids: ReadonlySet<string>) =>
    new Set([...ids].filter((id) => !removed.has(id)));

  return {
    anchor:
      selection.anchor !== null && removed.has(selection.anchor)
        ? null
        : selection.anchor,
    base: keep(selection.base),
    ids: keep(selection.ids),
  };
};

export const within = (
  selection: Selection,
  visible: ReadonlySet<string>
): Selection =>
  without(
    selection,
    new Set([...selection.ids].filter((id) => !visible.has(id)))
  );

let current = emptySelection;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const getSelection = () => current;

export const setSelection = (next: Selection) => {
  current = next;

  for (const listener of listeners) {
    listener();
  }
};

export const clearSelection = () => {
  if (current.ids.size > 0 || current.anchor !== null) {
    setSelection(emptySelection);
  }
};

export const deselect = (ids: ReadonlySet<string>) => {
  if ([...ids].some((id) => current.ids.has(id))) {
    setSelection(without(current, ids));
  }
};

export const hasSelection = () => current.ids.size > 0;

export const useSelection = () =>
  useSyncExternalStore(subscribe, getSelection, () => emptySelection);

export const useSelected = (id: string) =>
  useSyncExternalStore(
    subscribe,
    () => current.ids.has(id),
    () => false
  );

export const useSelecting = () =>
  useSyncExternalStore(subscribe, hasSelection, () => false);

export const useSelectionScope = (ids: string[]) => {
  const key = ids.join(" ");

  useEffect(() => {
    const next = within(current, new Set(key.split(" ")));

    if (next.ids.size < current.ids.size) {
      setSelection(next);
    }
  }, [key]);
};
