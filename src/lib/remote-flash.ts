import { useSyncExternalStore } from "react";

import type { IssueField } from "~/lib/api-types";

export interface RemoteChange {
  actorId?: string;
  fields?: IssueField[];
}

interface Flash extends RemoteChange {
  count: number;
}

const flashMs = 1600;
const flashing = new Map<string, Flash>();
const listeners = new Set<() => void>();

const notify = () => {
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

export const flashRemote = (
  changes: Iterable<string> | Map<string, RemoteChange>
) => {
  const entries =
    changes instanceof Map
      ? [...changes]
      : [...changes].map((id): [string, RemoteChange] => [id, {}]);

  const marked = entries.map(([id, change]) => {
    const count = (flashing.get(id)?.count ?? 0) + 1;

    flashing.set(id, { ...change, count });

    return { count, id };
  });

  if (marked.length === 0) {
    return;
  }

  notify();

  setTimeout(() => {
    for (const { count, id } of marked) {
      if (flashing.get(id)?.count === count) {
        flashing.delete(id);
      }
    }

    notify();
  }, flashMs);
};

const flashClasses = ["remote-flash", "remote-flash-again"] as const;

export const useRemoteFlash = (
  id: string,
  shown: readonly IssueField[] = []
) => {
  const flash = useSyncExternalStore(
    subscribe,
    () => flashing.get(id) ?? null,
    () => null
  );

  const className = flash === null ? undefined : flashClasses[flash.count % 2];

  const fields = flash?.fields ?? [];

  const inPlace =
    fields.length > 0 && new Set(fields).isSubsetOf(new Set(shown));

  return {
    actorId: flash?.actorId,
    field: (field: IssueField) =>
      inPlace && fields.includes(field) ? className : undefined,
    row: inPlace ? undefined : className,
  };
};
