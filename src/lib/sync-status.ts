import type { Connection } from "~/lib/realtime";

export type SyncPill = "offline" | "reconnecting" | "saving" | "synced";

export interface SyncShown {
  leaving: boolean;
  pill: SyncPill;
}

export const downDelayMs = 3000;
export const savingDelayMs = 1000;
export const syncedMs = 2000;
export const fadeMs = 180;

const timer = () => {
  let handle: ReturnType<typeof setTimeout> | null = null;

  return {
    active: () => handle !== null,
    clear: () => {
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },
    start: (run: () => void, delay: number) => {
      if (handle !== null) {
        clearTimeout(handle);
      }

      handle = setTimeout(() => {
        handle = null;
        run();
      }, delay);
    },
  };
};

export const createSyncStatus = () => {
  const listeners = new Set<() => void>();
  let connection: Connection = "live";
  let down = false;
  let saving = false;
  let synced = false;
  let shown: SyncShown | null = null;
  const downTimer = timer();
  const savingTimer = timer();
  const syncedTimer = timer();
  const fadeTimer = timer();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const wanted = (): SyncPill | null => {
    if (down) {
      return connection === "offline" ? "offline" : "reconnecting";
    }

    if (saving) {
      return "saving";
    }

    return synced ? "synced" : null;
  };

  const refresh = () => {
    const pill = wanted();

    if (pill !== null) {
      fadeTimer.clear();

      if (shown?.pill !== pill || shown.leaving) {
        shown = { leaving: false, pill };
        notify();
      }
    } else if (shown !== null && !shown.leaving) {
      shown = { ...shown, leaving: true };
      notify();
      fadeTimer.start(() => {
        shown = null;
        notify();
      }, fadeMs);
    }
  };

  const showSynced = () => {
    synced = true;
    syncedTimer.start(() => {
      synced = false;
      refresh();
    }, syncedMs);
  };

  const update = (next: { connection: Connection; pending: number }) => {
    ({ connection } = next);

    if (connection === "live") {
      downTimer.clear();

      if (down) {
        down = false;
        showSynced();
      }
    } else if (!down && !downTimer.active()) {
      downTimer.start(() => {
        down = true;
        refresh();
      }, downDelayMs);
    }

    if (next.pending === 0) {
      savingTimer.clear();

      if (saving) {
        saving = false;
        showSynced();
      }
    } else if (!saving && !savingTimer.active()) {
      savingTimer.start(() => {
        saving = true;
        refresh();
      }, savingDelayMs);
    }

    refresh();
  };

  const dispose = () => {
    for (const item of [downTimer, savingTimer, syncedTimer, fadeTimer]) {
      item.clear();
    }

    down = false;
    saving = false;
    synced = false;
    shown = null;
  };

  return {
    dispose,
    get: () => shown,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    update,
  };
};
