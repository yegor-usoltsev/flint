import { notifyManager, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";

import { toast } from "~/components/ui/toast";
import { api, ApiError } from "~/lib/api";
import type { Issue, Me } from "~/lib/api-types";
import { copyText } from "~/lib/copy";
import {
  onClearDrafts,
  readStoredDrafts,
  writeStoredDraft,
} from "~/lib/draft-storage";
import type { StoredDraft } from "~/lib/draft-storage";
import { notifyWithAction } from "~/lib/notify";
import { writeIssue } from "~/lib/use-update-issue";

export type DraftStatus = "conflict" | "error" | "pending" | "saved" | "saving";

export interface DraftWrite<Entity> {
  expect: string;
  expectedUser?: string;
  onConflict: (current: Entity) => void;
  onError: (error: Error) => void;
  onSaved: (saved: Entity) => void;
}

interface Draft {
  base: string;
  conflict: string | null;
  edits: number;
  retryable: boolean;
  status: DraftStatus;
  text: string;
}

const drafts = new Map<string, Draft>();
const texts = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const flushers = new Map<string, () => void>();
const mounted = new Map<string, number>();
const bases = new Map<string, string>();
const uploads = new Map<string, number>();
const listeners = new Set<() => void>();
const dirty = new Set<string>();
let owner: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let warning = false;
let editCount = 0;
let ownership = 0;
let retrying = false;

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const persist = () => {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  if (owner === null) {
    return;
  }

  for (const key of dirty) {
    const draft = drafts.get(key);
    const text = texts.get(key);

    let stored: StoredDraft | null =
      text === undefined || text.trim() === "" ? null : { text };

    if (draft !== undefined) {
      stored = { base: draft.base, text: draft.text };
    }

    if (writeStoredDraft(owner, key, stored)) {
      dirty.delete(key);
    }
  }
};

const markDirty = (key: string) => {
  dirty.add(key);
  persistTimer ??= setTimeout(persist, 300);
};

const warnOnUnload = (event: BeforeUnloadEvent) => {
  persist();

  if (
    uploads.size > 0 ||
    [...drafts.values()].some(
      ({ status }) => status === "pending" || status === "saving"
    ) ||
    [...dirty].some((key) => drafts.has(key) || Boolean(texts.get(key)?.trim()))
  ) {
    event.preventDefault();
  }
};

const emit = () => {
  if (!warning) {
    warning = true;
    addEventListener("beforeunload", warnOnUnload);
    addEventListener("pagehide", persist);
  }

  for (const listener of listeners) {
    listener();
  }
};

const put = (key: string, draft: Draft | null) => {
  if (draft === null) {
    drafts.delete(key);
  } else {
    drafts.set(key, draft);
  }

  markDirty(key);
  emit();
};

export const readStoredText = (key: string) => texts.get(key) ?? null;

export const setStoredText = (key: string, next: string | null) => {
  if (next === null) {
    texts.delete(key);
  } else {
    texts.set(key, next);
  }

  markDirty(key);
  emit();
};

const forgetDrafts = () => {
  ownership += 1;

  for (const timer of timers.values()) {
    clearTimeout(timer);
  }

  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  timers.clear();
  drafts.clear();
  texts.clear();
  dirty.clear();
  owner = null;
};

onClearDrafts(() => {
  forgetDrafts();
  emit();
});

export const adoptDrafts = (user: string) => {
  if (owner === user) {
    return;
  }

  if (owner !== null) {
    forgetDrafts();
  }

  owner = user;

  for (const [key, stored] of readStoredDrafts(user)) {
    if (stored.base === undefined) {
      if (!texts.has(key)) {
        texts.set(key, stored.text);
      }
    } else if (!drafts.has(key)) {
      drafts.set(key, {
        base: stored.base,
        conflict: null,
        edits: 0,
        retryable: false,
        status: "error",
        text: stored.text,
      });
    }
  }

  persist();
  emit();
};

export const useStoredText = (key: string) => {
  const snapshot = () => readStoredText(key);
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);

  const set = (next: string | null) => {
    setStoredText(key, next);
  };

  return [text, set, snapshot] as const;
};

export const trackUpload = (key: string, step: 1 | -1) => {
  const count = (uploads.get(key) ?? 0) + step;

  if (count > 0) {
    uploads.set(key, count);
  } else {
    uploads.delete(key);
  }

  emit();
};

export const useHasDraft = (keys: string[]) => {
  const snapshot = () => keys.some((key) => drafts.has(key));

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};

export const useUploading = (key: string) => {
  const snapshot = () => uploads.has(key);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};

const stopTimer = (key: string) => {
  clearTimeout(timers.get(key));
  timers.delete(key);
};

const flushDraft = (key: string) => {
  flushers.get(key)?.();
};

export const isRetryableDraftError = (error: Error) =>
  error instanceof TypeError ||
  (error instanceof ApiError && (error.status >= 500 || error.status === 429));

export const retryFailedDrafts = async () => {
  const user = owner;
  const generation = ownership;

  const failed = [...drafts].filter(([key, draft]) => {
    if (!draft.retryable || draft.conflict !== null) {
      return false;
    }

    return draft.status === "error" && (mounted.get(key) ?? 0) > 0;
  });

  if (retrying || user === null || failed.length === 0) {
    return;
  }

  retrying = true;

  let me: Me;

  try {
    me = await api<Me>("/me");
  } catch {
    retrying = false;

    return;
  }

  retrying = false;

  if (owner === user && ownership === generation && me.id === user) {
    for (const [key, draft] of failed) {
      if (drafts.get(key) === draft && (mounted.get(key) ?? 0) > 0) {
        flushDraft(key);
      }
    }
  }
};

const scheduleFlush = (key: string, delay: number) => {
  stopTimer(key);
  timers.set(
    key,
    setTimeout(() => {
      flushDraft(key);
    }, delay)
  );
};

export const readDraft = (key: string) => drafts.get(key);

export const discardDraft = (key: string) => {
  stopTimer(key);
  put(key, null);
};

export const editDraft = (key: string, text: string, base: string) => {
  const current = drafts.get(key);

  editCount += 1;
  put(key, {
    base: current?.base ?? base,
    conflict: current?.conflict ?? null,
    edits: editCount,
    retryable: false,
    status: "pending",
    text,
  });
};

// The query cache tells its observers on a later tick; clearing the draft at once would render the entity from before the save and send its old text to the editor, which then replaces its content and loses the caret. The draft clears only if nothing was typed since the save answered; otherwise the save becomes its base.
export const settleDraft = (key: string, saved: string) => {
  const edits = drafts.get(key)?.edits;
  const generation = ownership;

  notifyManager.schedule(() => {
    if (ownership !== generation) {
      return;
    }

    const current = drafts.get(key);

    if (current?.edits === edits && current?.text === saved) {
      put(key, null);
    } else if (current !== undefined) {
      put(key, { ...current, base: saved });
    }
  });
};

export const useDraft = <
  Field extends string,
  Entity extends Record<Field, string>,
>(
  id: string,
  entity: Entity,
  field: Field,
  delay: number | null,
  {
    label = field,
    name,
    write,
  }: {
    label?: string;
    name: string;
    write: (entity: Entity, text: string, options: DraftWrite<Entity>) => void;
  }
) => {
  const queryClient = useQueryClient();
  const key = `${id}:${field}`;

  const snapshot = () => drafts.get(key);
  const draft = useSyncExternalStore(subscribe, snapshot, snapshot);

  const update = (patch: Partial<Draft>) => {
    const current = drafts.get(key);

    if (current !== undefined) {
      put(key, { ...current, ...patch });
    }
  };

  const orphaned = (text: string, title: string) => {
    if ((mounted.get(key) ?? 0) === 0) {
      notifyWithAction({
        action: "Copy text",
        onAction: () => {
          void copyText(text, `your ${label}`);
        },
        title,
        type: "error",
      });
    }
  };

  const flush = () => {
    stopTimer(key);

    const current = drafts.get(key);

    if (current === undefined) {
      return;
    }

    const { base, text } = current;
    const generation = ownership;

    if (text === base && text === entity[field]) {
      put(key, null);

      return;
    }

    update({ retryable: false, status: "saving" });
    write(entity, text, {
      expect: base,
      expectedUser: owner ?? undefined,
      onConflict: (server) => {
        if (ownership !== generation) {
          return;
        }

        orphaned(
          text,
          `Your edit to the ${label} of ${name} conflicted with another edit`
        );
        update({ conflict: server[field], status: "conflict" });
      },
      onError: (error) => {
        if (ownership !== generation) {
          return;
        }

        update({ retryable: isRetryableDraftError(error), status: "error" });

        if (error instanceof ApiError && error.code === "user_changed") {
          toast.add({
            description: "The previous account's drafts cannot be saved here.",
            id: "draft-account-changed",
            title: "Your account changed",
            type: "error",
          });
          void queryClient.invalidateQueries({ queryKey: ["me"] });

          return;
        }

        orphaned(text, `Could not save the ${label} of ${name}`);

        if ((mounted.get(key) ?? 0) > 0) {
          notifyWithAction({
            action: "Retry",
            description: error.message,
            onAction: () => {
              flushDraft(key);
            },
            title: `Could not save the ${label} of ${name}`,
            type: "error",
          });
        }
      },
      onSaved: (saved) => {
        if (ownership === generation) {
          settleDraft(key, saved[field]);
        }
      },
    });
  };

  useLayoutEffect(() => {
    flushers.set(key, flush);
    bases.set(key, entity[field]);
  });

  const change = (text: string) => {
    editDraft(key, text, bases.get(key) ?? entity[field]);

    if (delay !== null) {
      scheduleFlush(key, delay);
    }
  };

  const discard = () => {
    discardDraft(key);
  };

  const rebase = (text: string) => {
    const current = drafts.get(key);

    if (current?.text === text) {
      discard();
    } else if (current !== undefined) {
      put(key, { ...current, base: text, conflict: null, status: "pending" });
      scheduleFlush(key, 600);
    }
  };

  const keepMine = () => {
    const conflict = drafts.get(key)?.conflict ?? null;

    if (conflict !== null) {
      update({ base: conflict, conflict: null });
    }

    flush();
  };

  const saved = entity[field];

  useEffect(() => {
    if (draft?.edits === 0 && draft.text === saved) {
      discardDraft(key);
    }
  }, [draft, key, saved]);

  useEffect(() => {
    mounted.set(key, (mounted.get(key) ?? 0) + 1);

    return () => {
      mounted.set(key, (mounted.get(key) ?? 1) - 1);

      if (timers.has(key)) {
        flushDraft(key);
      }
    };
  }, [key]);

  return {
    conflict: draft?.conflict ?? null,
    draft: {
      key,
      read: () => drafts.get(key)?.text ?? bases.get(key) ?? entity[field],
    },
    handleChange: change,
    handleDiscard: discard,
    handleRebase: rebase,
    handleFlush: flush,
    handleKeepMine: keepMine,
    status: draft?.status ?? "saved",
    value: draft?.text ?? entity[field],
  };
};

export type DraftField = "description" | "title";

export const useIssueDraft = (
  issue: Issue,
  field: DraftField,
  delay: number | null
) => {
  const queryClient = useQueryClient();

  return useDraft(`issue:${issue.id}`, issue, field, delay, {
    name: issue.key,
    write: (current, text, { expect, ...options }) => {
      writeIssue(
        queryClient,
        current,
        { [field]: text },
        { ...options, expect: { [field]: expect } }
      );
    },
  });
};
