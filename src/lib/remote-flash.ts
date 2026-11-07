import { useSyncExternalStore } from "react";

const flashMs = 1600;
const flashing = new Map<string, number>();
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

export const flashRemote = (ids: Iterable<string>) => {
  const marked = [...ids].map((id) => {
    const count = (flashing.get(id) ?? 0) + 1;

    flashing.set(id, count);

    return { count, id };
  });

  if (marked.length === 0) {
    return;
  }

  notify();

  setTimeout(() => {
    for (const { count, id } of marked) {
      if (flashing.get(id) === count) {
        flashing.delete(id);
      }
    }

    notify();
  }, flashMs);
};

const useFlashStamp = (id: string) =>
  useSyncExternalStore(
    subscribe,
    () => flashing.get(id) ?? 0,
    () => 0
  );

const flashClasses = ["remote-flash", "remote-flash-again"] as const;

export const useRemoteFlash = (id: string) => {
  const flash = useFlashStamp(id);

  return flash === 0 ? undefined : flashClasses[flash % 2];
};
