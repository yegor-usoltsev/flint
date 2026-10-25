// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { newId } from "~/lib/ids";

const prefix = "flint-draft:";
const maxAge = 30 * 24 * 60 * 60 * 1000;

export interface StoredDraft {
  base?: string;
  text: string;
}

const EntrySchema = v.object({
  at: v.number(),
  base: v.optional(v.string()),
  rev: v.optional(v.string(), ""),
  text: v.string(),
  user: v.string(),
});

const known = new Map<string, { content: string; rev: string }>();
const clearListeners = new Set<() => void>();

export const onClearDrafts = (listener: () => void) => {
  clearListeners.add(listener);
};

type Entry = v.InferOutput<typeof EntrySchema>;

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const storedNames = (store: Storage) =>
  Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
    (name): name is string => name?.startsWith(prefix) === true
  );

const parse = (raw: string | null) => {
  try {
    const result = v.safeParse(EntrySchema, JSON.parse(raw ?? ""));

    return result.success ? result.output : null;
  } catch {
    return null;
  }
};

const contentOf = ({ base, text }: StoredDraft) =>
  JSON.stringify([base ?? null, text]);

export const readStoredDrafts = (user: string) => {
  const found = new Map<string, StoredDraft>();
  const store = storage();

  if (store === null || store === undefined) {
    return found;
  }

  for (const name of storedNames(store)) {
    const entry = parse(store.getItem(name));

    if (
      entry === null ||
      entry.user !== user ||
      Date.now() - entry.at > maxAge
    ) {
      store.removeItem(name);
    } else {
      const key = name.slice(prefix.length);

      known.set(key, { content: contentOf(entry), rev: entry.rev });
      found.set(
        key,
        entry.base === undefined
          ? { text: entry.text }
          : { base: entry.base, text: entry.text }
      );
    }
  }

  return found;
};

export const writeStoredDraft = (
  user: string,
  key: string,
  draft: StoredDraft | null
) => {
  const store = storage();

  if (store === null || store === undefined) {
    return false;
  }

  try {
    if (draft === null) {
      const current = parse(store.getItem(prefix + key));

      if (current === null || current.rev === known.get(key)?.rev) {
        store.removeItem(prefix + key);
      }

      known.delete(key);
    } else if (contentOf(draft) !== known.get(key)?.content) {
      const entry: Entry = {
        ...draft,
        at: Date.now(),
        rev: newId(),
        user,
      };

      store.setItem(prefix + key, JSON.stringify(entry));
      known.set(key, { content: contentOf(entry), rev: entry.rev });
    }

    return true;
  } catch {
    return false;
  }
};

export const clearStoredDrafts = () => {
  for (const listener of clearListeners) {
    listener();
  }

  known.clear();

  const store = storage();

  if (store !== null && store !== undefined) {
    for (const name of storedNames(store)) {
      store.removeItem(name);
    }
  }
};
