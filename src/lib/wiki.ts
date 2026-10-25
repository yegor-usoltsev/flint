import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { api, ApiError, isNotFound, request } from "~/lib/api";
import type {
  WikiNodeKind,
  WikiPage,
  WikiPageSummary,
  WikiRevision,
  WikiRevisionSummary,
  Workspace,
} from "~/lib/api-types";
import { newId } from "~/lib/ids";
import { sortKeyBetween } from "~/lib/issue-view";
import { readDraft } from "~/lib/use-draft";
import type { DraftWrite } from "~/lib/use-draft";

export interface Wiki {
  api: string;
  key: string;
  name: string;
  slug: string;
  workspaceId: string;
}

export const workspaceWiki = (workspace: Workspace): Wiki => ({
  api: `/workspaces/${workspace.slug}/wiki`,
  key: workspace.slug,
  name: workspace.name,
  slug: workspace.slug,
  workspaceId: workspace.id,
});

export const wikiPagesQuery = (wiki: Wiki) =>
  queryOptions({
    queryFn: async () => await api<WikiPageSummary[]>(wiki.api),
    queryKey: ["wiki", wiki.key, "pages"],
  });

export const isOlderPage = (page: WikiPage, than: WikiPage) => {
  if (page.id !== than.id) {
    return false;
  }

  const created = Date.parse(page.createdAt) - Date.parse(than.createdAt);

  return created === 0 ? page.revision < than.revision : created < 0;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- TanStack Query passes structuralSharing the query data untyped.
const keepNewer = (old: unknown, next: unknown) => {
  // SAFETY: both values are data of a wikiPageQuery, so they are pages.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See the SAFETY note.
  const [before, after] = [old, next] as (WikiPage | undefined)[];

  return before !== undefined &&
    after !== undefined &&
    isOlderPage(after, before)
    ? old
    : next;
};

export const wikiPageQuery = (wiki: Wiki, path: string) =>
  queryOptions({
    queryFn: async () => await api<WikiPage>(`${wiki.api}/${path}`),
    queryKey: ["wiki", wiki.key, "page", path],
    structuralSharing: keepNewer,
  });

export const wikiRevisionsQuery = (wiki: Wiki, pageId: string) =>
  queryOptions({
    queryFn: async () =>
      await api<WikiRevisionSummary[]>(`/wiki/${pageId}/revisions`),
    queryKey: ["wiki", wiki.key, "revisions", pageId],
  });

export const wikiRevisionQuery = (
  wiki: Wiki,
  pageId: string,
  revision: number
) =>
  queryOptions({
    queryFn: async () =>
      await api<WikiRevision>(`/wiki/${pageId}/revisions/${revision}`),
    queryKey: ["wiki", wiki.key, "revisions", pageId, revision],
    staleTime: Infinity,
  });

export const pathPattern = /^[a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)*$/u;

const quoteList = (chars: string[]) =>
  chars.map((char) => (char === " " ? "spaces" : `“${char}”`)).join(", ");

export const pathProblem = (path: string) => {
  if (path === "" || pathPattern.test(path)) {
    return null;
  }

  const invalid = [...new Set(path.replaceAll(/[\w./-]/gu, ""))];

  if (invalid.length > 0) {
    return `A path cannot contain ${quoteList(invalid)}.`;
  }

  if (path.split("/").includes("")) {
    return "Remove the empty part between the “/” characters.";
  }

  return "Start each part of the path with a letter or digit.";
};

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9._]+/gu, "-")
    .replaceAll(/^[-._]+|-$/gu, "")
    .slice(0, 80);

export const humanize = (path: string) => {
  const name = (path.split("/").at(-1) ?? path).replaceAll(/[_.-]+/gu, " ");

  return name.charAt(0).toUpperCase() + name.slice(1);
};

export interface WikiNode {
  children: WikiNode[];
  page?: WikiPageSummary;
  path: string;
  title: string;
}

export const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const bySortKey = (a: WikiNode, b: WikiNode) => {
  const [left, right] = [a.page?.sortKey ?? "~", b.page?.sortKey ?? "~"];

  if (left !== right) {
    return left < right ? -1 : 1;
  }

  return a.path < b.path ? -1 : 1;
};

export type WikiSort = "edited" | "manual";

const sortListeners = new Set<() => void>();

export const rememberWikiSort = (sort: WikiSort) => {
  localStorage.setItem("wiki-sort", sort);

  for (const listener of sortListeners) {
    listener();
  }
};

const subscribeSort = (listener: () => void) => {
  sortListeners.add(listener);

  return () => {
    sortListeners.delete(listener);
  };
};

export const useWikiSort = (): WikiSort =>
  useSyncExternalStore(
    subscribeSort,
    () =>
      localStorage.getItem("wiki-sort") === "edited" ? "edited" : "manual",
    () => "manual"
  );

const foldersKey = (wiki: Wiki) => `wiki-folders:${wiki.workspaceId}`;

const folderListeners = new Set<() => void>();

const storedFolders = (wiki: Wiki) =>
  (localStorage.getItem(foldersKey(wiki)) ?? "")
    .split("\n")
    .filter((path) => path !== "");

const rememberFolders = (wiki: Wiki, paths: string[]) => {
  localStorage.setItem(foldersKey(wiki), paths.join("\n"));

  for (const listener of folderListeners) {
    listener();
  }
};

const subscribeFolders = (listener: () => void) => {
  folderListeners.add(listener);

  return () => {
    folderListeners.delete(listener);
  };
};

const pathPrefixes = (path: string) =>
  path === ""
    ? []
    : path
        .split("/")
        .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

export const setFolderOpen = (wiki: Wiki, path: string, open: boolean) => {
  const paths = storedFolders(wiki).filter((stored) => stored !== path);

  rememberFolders(wiki, open ? [...paths, path] : paths);
};

export const revealPath = (wiki: Wiki, path: string) => {
  const paths = storedFolders(wiki);
  const next = new Set([...paths, ...pathPrefixes(path)]);

  if (next.size > paths.length) {
    rememberFolders(wiki, [...next]);
  }
};

export const useOpenFolders = (wiki: Wiki, current: string) =>
  new Set(
    useSyncExternalStore(
      subscribeFolders,
      () => localStorage.getItem(foldersKey(wiki)) ?? "",
      () => pathPrefixes(current).join("\n")
    ).split("\n")
  );

export const recentPages = (pages: WikiPageSummary[], folder: string) =>
  pages
    .filter(
      (page) =>
        page.kind === "page" &&
        (folder === "" || page.path.startsWith(`${folder}/`))
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const buildTree = (pages: WikiPageSummary[]) => {
  const root: WikiNode[] = [];
  const nodes = new Map<string, WikiNode>();

  const nodeAt = (path: string): WikiNode => {
    const existing = nodes.get(path);

    if (existing !== undefined) {
      return existing;
    }

    const node: WikiNode = {
      children: [],
      path,
      title: humanize(path),
    };

    const parent = path.includes("/") ? nodeAt(parentOf(path)).children : root;

    nodes.set(path, node);
    parent.push(node);

    return node;
  };

  for (const page of pages) {
    Object.assign(nodeAt(page.path), { page, title: page.title });
  }

  const sort = (list: WikiNode[]) => {
    list.sort(bySortKey);

    for (const node of list) {
      sort(node.children);
    }
  };

  sort(root);

  return root;
};

export const findNode = (
  nodes: WikiNode[],
  path: string
): WikiNode | undefined => {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }

    if (path.startsWith(`${node.path}/`)) {
      return findNode(node.children, path);
    }
  }

  return undefined;
};

export const countNodes = (nodes: WikiNode[], kind: WikiNodeKind): number =>
  nodes.reduce(
    (sum, node) =>
      sum + Number(node.page?.kind === kind) + countNodes(node.children, kind),
    0
  );

const counted = (count: number, kind: WikiNodeKind) =>
  count === 1 ? `1 ${kind}` : `${count} ${kind}s`;

export const contentsText = (nodes: WikiNode[]) => {
  const parts = [
    counted(countNodes(nodes, "page"), "page"),
    counted(countNodes(nodes, "folder"), "folder"),
  ].filter((part) => !part.startsWith("0 "));

  return parts.join(" and ");
};

export const maxPathLength = 200;

const deepest = (node: WikiNode): number =>
  Math.max(node.path.length, ...node.children.map(deepest));

export const longestMovedPath = (
  tree: WikiNode[],
  from: string,
  to: string
) => {
  const node = findNode(tree, from);

  return node === undefined
    ? to.length
    : deepest(node) - from.length + to.length;
};

export const inSubtree = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

export const movedPath = (path: string, from: string, to: string) =>
  inSubtree(path, from) ? `${to}${path.slice(from.length)}` : path;

export type DropZone = "after" | "before" | "inside";

export const dropPlacement = (
  tree: WikiNode[],
  source: string,
  target: string,
  zone: DropZone
) => {
  const parent = zone === "inside" ? target : parentOf(target);

  const present =
    findNode(tree, source)?.page !== undefined &&
    findNode(tree, target) !== undefined;

  if (
    !present ||
    inSubtree(parent, source) ||
    (zone !== "inside" && target === source)
  ) {
    return null;
  }

  const all = parent === "" ? tree : (findNode(tree, parent)?.children ?? []);
  const siblings = all.filter((node) => node.path !== source);
  const offsets = { after: 1, before: 0, inside: siblings.length };

  const index =
    offsets[zone] +
    (zone === "inside"
      ? 0
      : siblings.findIndex((node) => node.path === target));

  const order = siblings.map((node) => node.path);

  order.splice(index, 0, source);

  if (order.join("\n") === all.map((node) => node.path).join("\n")) {
    return null;
  }

  const name = source.slice(source.lastIndexOf("/") + 1);
  const path = parent === "" ? name : `${parent}/${name}`;

  if (longestMovedPath(tree, source, path) > maxPathLength) {
    return null;
  }

  return {
    path,
    sortKey: sortKeyBetween(
      siblings[index - 1]?.page?.sortKey,
      siblings[index]?.page?.sortKey
    ),
  };
};

export const ancestors = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));

type PageField = "body" | "title";

interface PageWrite extends DraftWrite<WikiPage> {
  field: PageField;
  text: string;
}

interface PageQueue {
  base: WikiPage;
  retries: number;
  wiki: Wiki;
  writes: PageWrite[];
}

const maxRetries = 3;

const queues = new Map<string, PageQueue>();

export const setPage = (
  queryClient: QueryClient,
  wiki: Wiki,
  page: WikiPage
) => {
  queryClient.setQueryData(wikiPageQuery(wiki, page.path).queryKey, page);
  void queryClient.invalidateQueries({
    queryKey: wikiPagesQuery(wiki).queryKey,
  });
};

const atQueuePath = (queue: PageQueue, page: WikiPage) =>
  page.id === queue.base.id ? { ...page, path: queue.base.path } : page;

const fail = (
  queryClient: QueryClient,
  queue: PageQueue,
  current: WikiPage | undefined,
  error: Error
) => {
  const [write] = queue.writes;

  queue.writes.shift();
  queue.retries = 0;

  if (current === undefined) {
    write?.onError(error);

    return;
  }

  const page = atQueuePath(queue, current);

  if (page.id === queue.base.id) {
    queue.base = page;
  }

  setPage(queryClient, queue.wiki, page);
  write?.onConflict(page);
};

const saved = (
  queryClient: QueryClient,
  queue: PageQueue,
  response: WikiPage
) => {
  const [write] = queue.writes;
  const page = atQueuePath(queue, response);

  queue.writes.shift();
  queue.retries = 0;
  queue.base = page;

  for (const next of queue.writes) {
    if (next.field === write?.field) {
      next.expect = page[next.field];
    }
  }

  setPage(queryClient, queue.wiki, page);
  write?.onSaved(page);
};

const relocated = async (queue: PageQueue) => {
  try {
    const { path } = await request("GET /wiki/:pageId", {
      params: { pageId: queue.base.id },
    });

    if (path === queue.base.path) {
      return false;
    }

    queue.base = { ...queue.base, path };

    return true;
  } catch {
    return false;
  }
};

const attempt = async (
  queryClient: QueryClient,
  queue: PageQueue,
  write: PageWrite
) => {
  try {
    saved(
      queryClient,
      queue,
      await api<WikiPage>(`${queue.wiki.api}/${queue.base.path}`, {
        body: {
          [write.field]: write.text,
          baseRevision: queue.base.revision,
          id: queue.base.id,
        },
        method: write.field === "body" ? "PUT" : "PATCH",
      })
    );
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409;
    // SAFETY: a 409 from the wiki API carries the canonical page in `current`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The API contract types `current`.
    const current = conflict ? (error.current as WikiPage) : undefined;

    const lost =
      error instanceof ApiError &&
      (error.status === 404 || (conflict && current?.id !== queue.base.id));

    if (lost && (await relocated(queue))) {
      return;
    }

    if (lost && current !== undefined) {
      setPage(queryClient, queue.wiki, current);
      fail(
        queryClient,
        queue,
        undefined,
        new Error(`Another page now uses ${queue.base.path}`)
      );

      return;
    }

    if (
      current?.id === queue.base.id &&
      current[write.field] === write.expect &&
      queue.retries < maxRetries
    ) {
      queue.retries += 1;
      queue.base = atQueuePath(queue, current);
    } else {
      fail(
        queryClient,
        queue,
        current,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
};

const send = async (queryClient: QueryClient, queue: PageQueue) => {
  const [write] = queue.writes;

  if (write === undefined) {
    queues.delete(queue.base.id);

    return;
  }

  const cached = queryClient.getQueryData(
    wikiPageQuery(queue.wiki, queue.base.path).queryKey
  );

  if (cached !== undefined && isOlderPage(queue.base, cached)) {
    queue.base = cached;
  }

  if (queue.base[write.field] === write.expect) {
    await attempt(queryClient, queue, write);
  } else {
    fail(queryClient, queue, queue.base, new Error("Changed elsewhere"));
  }

  await send(queryClient, queue);
};

export const writePage = (
  queryClient: QueryClient,
  wiki: Wiki,
  page: WikiPage,
  field: PageField,
  text: string,
  options: DraftWrite<WikiPage>
) => {
  const existing = queues.get(page.id);
  const queue = existing ?? { base: page, retries: 0, wiki, writes: [] };
  const last = queue.writes.length > 1 ? queue.writes.at(-1) : undefined;

  if (last?.field === field) {
    Object.assign(last, { ...options, expect: last.expect, text });
  } else {
    queue.writes.push({ ...options, field, text });
  }

  if (existing === undefined) {
    queues.set(page.id, queue);
    void send(queryClient, queue);
  }
};

export const missingState = (
  pageError: Error | null,
  lookupError: Error | null
) => {
  if (pageError === null || !isNotFound(pageError) || lookupError === null) {
    return null;
  }

  return isNotFound(lookupError) ? "deleted" : "unknown";
};

export const wikiTarget = (wiki: Pick<Wiki, "slug">, path: string) => ({
  params: { _splat: path, slug: wiki.slug },
  to: "/$slug/wiki/$" as const,
});

export const moveNode = async (
  queryClient: QueryClient,
  wiki: Wiki,
  node: Pick<WikiPageSummary, "id" | "path">,
  path: string,
  sortKey?: string
) => {
  const moved = await request("POST /wiki/:pageId/move", {
    body: { path, sortKey },
    params: { pageId: node.id },
  });

  for (const queue of queues.values()) {
    if (queue.wiki.key === wiki.key) {
      queue.base = {
        ...queue.base,
        path: movedPath(queue.base.path, node.path, moved.path),
      };
    }
  }

  setPage(queryClient, wiki, moved);

  return moved;
};

export const wikiDraftId = (pageId: string) => `wiki:${pageId}`;

export const wikiDraftText = (pageId: string, field: "body" | "title") =>
  readDraft(`${wikiDraftId(pageId)}:${field}`)?.text;

export const wikiDraftKeys = (pageId: string) => [
  `${wikiDraftId(pageId)}:title`,
  `${wikiDraftId(pageId)}:body`,
];

export const keptPage = ({
  dirty,
  fetched,
  kept,
  shown,
}: {
  dirty: boolean;
  fetched: WikiPage | undefined;
  kept: WikiPage | null;
  shown: WikiPage | undefined;
}) => {
  if (kept !== null) {
    return kept;
  }

  const replaced =
    shown !== undefined &&
    fetched !== undefined &&
    fetched.id !== shown.id &&
    fetched.path === shown.path;

  return replaced && dirty ? shown : null;
};

const keptPages = new Map<string, WikiPage>();

export const keptKey = (wiki: Wiki, path: string) =>
  `${wiki.workspaceId}:${path}`;

export const readKept = (key: string) => keptPages.get(key) ?? null;

export interface KeptState {
  kept: WikiPage | null;
  key: string;
  shown: WikiPage | undefined;
}

export const nextKept = (
  state: KeptState,
  key: string,
  fetched: WikiPage | undefined,
  dirty: boolean
): KeptState | null => {
  if (state.key !== key) {
    return { kept: readKept(key), key, shown: fetched };
  }

  if (state.shown === fetched) {
    return null;
  }

  return {
    kept: keptPage({ dirty, fetched, kept: state.kept, shown: state.shown }),
    key,
    shown: fetched,
  };
};

export const storeKept = (key: string, page: WikiPage | null) => {
  if (page === null) {
    keptPages.delete(key);
  } else {
    keptPages.set(key, page);
  }
};

const withSuffix = (path: string, suffix: string) => {
  const cut = path.lastIndexOf("/") + 1;
  const room = maxPathLength - cut - suffix.length;

  return room > 0
    ? `${path.slice(0, cut)}${path.slice(cut, cut + room)}${suffix}`
    : null;
};

export const freePath = (path: string, taken: Set<string>) => {
  const suffixes = [
    "-copy",
    ...Array.from({ length: taken.size }, (_, index) => `-copy-${index + 2}`),
  ];

  return (
    suffixes
      .map((suffix) => withSuffix(path, suffix))
      .find((candidate) => candidate !== null && !taken.has(candidate)) ??
    newId()
  );
};

export const saveAsNewPage = async (
  wiki: Wiki,
  from: string,
  content: { body: string; title: string },
  taken: Set<string>,
  attempts = 5
): Promise<WikiPage> => {
  const path = freePath(from, taken);

  try {
    return await request("PUT /workspaces/:slug/wiki/*", {
      body: { ...content, baseRevision: 0, id: newId() },
      params: { _splat: path, slug: wiki.slug },
    });
  } catch (error) {
    const occupied = error instanceof ApiError && error.status === 409;

    if (!occupied || attempts <= 1) {
      throw error;
    }

    return await saveAsNewPage(
      wiki,
      from,
      content,
      new Set([...taken, path]),
      attempts - 1
    );
  }
};
