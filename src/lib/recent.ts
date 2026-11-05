import { useEffect, useSyncExternalStore } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

const RecentSchema = v.array(
  v.object({
    href: v.string(),
    kind: v.picklist(["issue", "page"]),
    label: v.string(),
    statusId: v.optional(v.string()),
    title: v.string(),
  })
);

export type RecentItem = v.InferOutput<typeof RecentSchema>[number];

const limit = 8;
const empty: RecentItem[] = [];
const listeners = new Set<() => void>();
const cache = new Map<string, { items: RecentItem[]; raw: string | null }>();

const storageKey = (slug: string) => `flint:recent:${slug}`;

const read = (slug: string) => {
  const raw = localStorage.getItem(storageKey(slug));
  const cached = cache.get(slug);

  if (cached?.raw === raw) {
    return cached.items;
  }

  let items = empty;

  try {
    const parsed = v.safeParse(RecentSchema, JSON.parse(raw ?? "[]"));

    items = parsed.success ? parsed.output : empty;
  } catch {
    items = empty;
  }

  cache.set(slug, { items, raw });

  return items;
};

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

export const rememberRecent = (slug: string, item: RecentItem) => {
  const items = [
    item,
    ...read(slug).filter((entry) => entry.href !== item.href),
  ].slice(0, limit);

  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    return;
  }

  notify();
};

export const useRememberRecent = (
  slug: string,
  item: RecentItem | undefined
) => {
  const href = item?.href;
  const kind = item?.kind;
  const label = item?.label;
  const statusId = item?.statusId;
  const title = item?.title;

  useEffect(() => {
    if (href === undefined || kind === undefined) {
      return;
    }

    if (label !== undefined && title !== undefined) {
      rememberRecent(slug, { href, kind, label, statusId, title });
    }
  }, [href, kind, label, slug, statusId, title]);
};

export const useRecent = (slug: string) =>
  useSyncExternalStore(
    subscribe,
    () => read(slug),
    () => empty
  );
