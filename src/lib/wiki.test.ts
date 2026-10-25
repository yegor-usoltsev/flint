import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import { QueryClient } from "@tanstack/react-query";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { ApiError } from "~/lib/api";
import type { WikiPage } from "~/lib/api-types";
import { discardDraft, editDraft } from "~/lib/use-draft";
import {
  buildTree,
  contentsText,
  dropPlacement,
  freePath,
  isOlderPage,
  keptKey,
  keptPage,
  longestMovedPath,
  missingState,
  nextKept,
  moveNode,
  saveAsNewPage,
  pathProblem,
  readKept,
  recentPages,
  revealPath,
  setFolderOpen,
  slugify,
  storeKept,
  wikiDraftId,
  wikiDraftText,
  wikiPageQuery,
  writePage,
} from "~/lib/wiki";
import type { Wiki } from "~/lib/wiki";

const wiki: Wiki = {
  api: "/workspaces/acme/wiki",
  key: "acme",
  name: "Acme",
  slug: "acme",
  workspaceId: "w1",
};

const page: WikiPage = {
  body: "old body",
  createdAt: "2026-01-01T00:00:00Z",
  id: "p1",
  kind: "page",
  path: "guides/setup",
  revision: 1,
  sortKey: "a0",
  title: "Setup",
  updatedAt: "2026-01-01T00:00:00Z",
  updatedBy: {
    avatarUrl: "",
    displayName: "alice",
    id: "u",
    username: "alice",
  },
  workspaceSlug: "acme",
};

const BodySchema = v.object({
  baseRevision: v.number(),
  body: v.optional(v.string()),
  title: v.optional(v.string()),
});

const conflict = (current: WikiPage) =>
  Response.json(
    { error: { code: "conflict", current, message: "stale" } },
    { status: 409 }
  );

const write = async (
  queryClient: QueryClient,
  field: "body" | "title",
  text: string,
  base: string,
  from = page
) => {
  const { promise, resolve } = Promise.withResolvers<string>();

  writePage(queryClient, wiki, from, field, text, {
    expect: base,
    onConflict: (current) => {
      resolve(`conflict:${current[field]}`);
    },
    onError: (error) => {
      resolve(`error:${error.message}`);
    },
    onSaved: (saved) => {
      resolve(`saved:${saved[field]}:r${saved.revision}`);
    },
  });

  return await promise;
};

const summary = (path: string, title: string, sortKey = "a0") => ({
  id: path,
  kind: "page" as const,
  path,
  revision: 1,
  sortKey,
  title,
  updatedAt: "",
});

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

describe("wiki tree", () => {
  test("nests pages by path and fills missing parents", () => {
    const tree = buildTree([
      summary("guides/setup", "Setup"),
      summary("about", "About us"),
      summary("guides/deploy/s3", "S3"),
    ]);

    expect(
      tree.map((node) => [node.path, node.title, node.page?.id ?? null])
    ).toEqual([
      ["about", "About us", "about"],
      ["guides", "Guides", null],
    ]);
    expect(tree[1]?.children.map((node) => node.path)).toEqual([
      "guides/setup",
      "guides/deploy",
    ]);
    expect(tree[1]?.children[1]?.children[0]?.title).toBe("S3");
  });

  const ordered = buildTree([
    summary("b", "B", "a0"),
    summary("a", "A", "a1"),
    summary("a/x", "X", "a0"),
    summary("c", "C", "a2"),
  ]);

  test("orders siblings by sort key", () => {
    expect(ordered.map((node) => node.path)).toEqual(["b", "a", "c"]);
  });

  test("places a drop between its new neighbors", () => {
    expect(dropPlacement(ordered, "c", "b", "after")).toMatchObject({
      path: "c",
    });
    const key = dropPlacement(ordered, "c", "b", "after")?.sortKey ?? "";

    expect(key > "a0" && key < "a1").toBe(true);
    expect(dropPlacement(ordered, "b", "a", "inside")).toMatchObject({
      path: "a/b",
    });
    expect(dropPlacement(ordered, "a/x", "c", "after")?.path).toBe("x");
  });

  test("ignores a drop that changes nothing or enters its own subtree", () => {
    expect(dropPlacement(ordered, "b", "a", "before")).toBeNull();
    expect(dropPlacement(ordered, "a", "a/x", "inside")).toBeNull();
    expect(dropPlacement(ordered, "a", "a", "inside")).toBeNull();
  });

  test("ignores a drop whose source or target is gone", () => {
    expect(dropPlacement(ordered, "gone", "a", "after")).toBeNull();
    expect(dropPlacement(ordered, "b", "gone", "after")).toBeNull();
    expect(dropPlacement(ordered, "b", "a/gone", "inside")).toBeNull();
  });

  test("turns a title into a valid path segment", () => {
    expect(slugify("Setup & Deploy: S3!")).toBe("setup-deploy-s3");
    expect(slugify("  .hidden_file ")).toBe("hidden_file");
  });
});

test("recentPages lists a folder's pages at any depth, newest edit first", () => {
  const pages = [
    { ...summary("guides", "Guides"), kind: "folder" as const },
    { ...summary("guides/setup", "Setup"), updatedAt: "2026-10-01T10:00:00Z" },
    {
      ...summary("guides/deploy/s3", "S3"),
      updatedAt: "2026-10-03T10:00:00Z",
    },
    { ...summary("guidesx", "Other"), updatedAt: "2026-10-04T10:00:00Z" },
  ];

  expect(recentPages(pages, "guides").map((entry) => entry.path)).toEqual([
    "guides/deploy/s3",
    "guides/setup",
  ]);
  expect(recentPages(pages, "").map((entry) => entry.path)).toEqual([
    "guidesx",
    "guides/deploy/s3",
    "guides/setup",
  ]);
});

describe("open folders", () => {
  const items = new Map<string, string>();
  const openFolders = () => items.get("wiki-folders:w1")?.split("\n");

  beforeAll(() => {
    globalThis.localStorage = {
      clear: () => {
        items.clear();
      },
      getItem: (name) => items.get(name) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      get length() {
        return items.size;
      },
      removeItem: (name) => {
        items.delete(name);
      },
      setItem: (name, value) => {
        items.set(name, value);
      },
    };
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  test("navigation opens the page's ancestors and closes nothing", () => {
    setFolderOpen(wiki, "alpha", true);
    revealPath(wiki, "beta/deep/page");
    revealPath(wiki, "");

    expect(openFolders()).toEqual([
      "alpha",
      "beta",
      "beta/deep",
      "beta/deep/page",
    ]);

    setFolderOpen(wiki, "alpha", false);
    revealPath(wiki, "beta/deep/page");

    expect(openFolders()).toEqual(["beta", "beta/deep", "beta/deep/page"]);
  });
});

describe("wiki limits", () => {
  const folder = (path: string) => ({
    ...summary(path, path),
    kind: "folder" as const,
  });

  test("contentsText counts pages and folders apart", () => {
    const [root] = buildTree([
      folder("doomed"),
      summary("doomed/c", "C"),
      folder("doomed/d"),
      summary("doomed/d/e", "E"),
      summary("doomed/d/f", "F"),
    ]);

    expect(contentsText(root?.children ?? [])).toBe("3 pages and 1 folder");
    expect(contentsText(root?.children[1]?.children ?? [])).toBe("2 pages");
    expect(contentsText([])).toBe("");
  });

  const long = `a/${"x".repeat(197)}`;

  const tree = buildTree([
    folder("a"),
    summary(long, "Long"),
    summary("b", "B"),
  ]);

  test("longestMovedPath measures the deepest descendant", () => {
    expect(longestMovedPath(tree, "a", "ab")).toBe(200);
    expect(longestMovedPath(tree, "a", "abc")).toBe(201);
    expect(longestMovedPath(tree, "b", "a/b")).toBe(3);
  });

  test("dropPlacement refuses a drop that makes a path too long", () => {
    expect(dropPlacement(tree, "b", long, "inside")).toBeNull();
    expect(dropPlacement(tree, "a", "b", "inside")).toBeNull();
    expect(dropPlacement(tree, "b", "a", "inside")).toMatchObject({
      path: "a/b",
    });
  });
});

describe("missing page state", () => {
  const notFound = new ApiError(404, {
    code: "not_found",
    message: "Wiki page not found",
  });

  test("only a 404 from the id lookup means the page was deleted", () => {
    expect(missingState(notFound, notFound)).toBe("deleted");
    expect(
      missingState(
        notFound,
        new ApiError(500, { code: "internal", message: "x" })
      )
    ).toBe("unknown");
    expect(missingState(notFound, new TypeError("Failed to fetch"))).toBe(
      "unknown"
    );
    expect(missingState(notFound, null)).toBeNull();
    expect(
      missingState(
        new ApiError(500, { code: "internal", message: "x" }),
        notFound
      )
    ).toBeNull();
  });
});

describe("wiki page writes", () => {
  test("a conflict on the other field retries on the new revision", async () => {
    const queryClient = new QueryClient();
    const revisions: number[] = [];

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = v.parse(
            BodySchema,
            await new Response(init?.body).json()
          );

          revisions.push(body.baseRevision);

          return body.baseRevision === 1
            ? conflict({ ...page, revision: 2, title: "Renamed" })
            : Response.json({ ...page, body: "mine", revision: 3 });
        },
        { preconnect: fetch.preconnect }
      )
    );

    expect(await write(queryClient, "body", "mine", "old body")).toBe(
      "saved:mine:r3"
    );
    expect(revisions).toEqual([1, 2]);
    expect(
      queryClient.getQueryData(wikiPageQuery(wiki, page.path).queryKey)
        ?.revision
    ).toBe(3);
  });

  test("writes queued before a move go to the new path", async () => {
    const queryClient = new QueryClient();
    const urls: string[] = [];
    const held = Promise.withResolvers<Response>();

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const url = input instanceof Request ? input.url : input.toString();

          urls.push(url);

          if (url.endsWith("/move")) {
            return Response.json({ ...page, path: "guides/start" });
          }

          return url.endsWith("/guides/setup")
            ? await held.promise
            : Response.json({
                ...page,
                path: "guides/start",
                revision: 3,
                title: "Start",
              });
        },
        { preconnect: fetch.preconnect }
      )
    );

    const body = write(queryClient, "body", "mine", "old body");
    const title = write(queryClient, "title", "Start", "Setup");

    await moveNode(queryClient, wiki, page, "guides/start");
    held.resolve(Response.json({ ...page, body: "mine", revision: 2 }));

    expect(await body).toBe("saved:mine:r2");
    expect(await title).toBe("saved:Start:r3");
    expect(urls).toEqual([
      "/api/v1/workspaces/acme/wiki/guides/setup",
      "/api/v1/wiki/p1/move",
      "/api/v1/workspaces/acme/wiki/guides/start",
    ]);
  });

  test("a write after a remote move finds the page by id", async () => {
    const queryClient = new QueryClient();
    const calls: string[] = [];
    const held = Promise.withResolvers<Response>();
    let first = true;

    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : input.toString();

          calls.push(`${init?.method ?? "GET"} ${url}`);

          if (first) {
            first = false;

            return await held.promise;
          }

          if (url.endsWith("/wiki/p1")) {
            return Response.json({ ...page, path: "guides/start" });
          }

          return url.endsWith("/guides/setup")
            ? Response.json(
                {
                  error: { code: "not_found", message: "Wiki page not found" },
                },
                { status: 404 }
              )
            : Response.json({ ...page, path: "guides/start", title: "Start" });
        },
        { preconnect: fetch.preconnect }
      )
    );

    const body = write(queryClient, "body", "mine", "old body");
    const title = write(queryClient, "title", "Start", "Setup");

    held.resolve(Response.json({ ...page, body: "mine", revision: 2 }));

    expect(await body).toBe("saved:mine:r2");
    expect(await title).toBe("saved:Start:r1");
    expect(calls).toEqual([
      "PUT /api/v1/workspaces/acme/wiki/guides/setup",
      "PATCH /api/v1/workspaces/acme/wiki/guides/setup",
      "GET /api/v1/wiki/p1",
      "PATCH /api/v1/workspaces/acme/wiki/guides/start",
    ]);
  });

  test("a conflict on the same field reports the saved text", async () => {
    const queryClient = new QueryClient();

    spyOn(globalThis, "fetch").mockResolvedValue(
      conflict({ ...page, body: "agent text", revision: 2 })
    );

    expect(await write(queryClient, "body", "mine", "old body")).toBe(
      "conflict:agent text"
    );
  });

  test("a draft older than the cached page conflicts without a request", async () => {
    const queryClient = new QueryClient();
    const fetches = spyOn(globalThis, "fetch");

    queryClient.setQueryData(wikiPageQuery(wiki, page.path).queryKey, {
      ...page,
      body: "agent text",
      revision: 5,
    });

    expect(await write(queryClient, "body", "mine", "old body")).toBe(
      "conflict:agent text"
    );
    expect(fetches).not.toHaveBeenCalled();
  });

  test("a late refetch never replaces a newer cached revision", async () => {
    const queryClient = new QueryClient();
    const query = wikiPageQuery(wiki, page.path);

    spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ...page, revision: 3 })
    );
    queryClient.setQueryData(query.queryKey, { ...page, revision: 4 });
    await queryClient.query({ ...query, staleTime: 0 });

    expect(queryClient.getQueryData(query.queryKey)?.revision).toBe(4);
  });

  const deleted = { ...page, revision: 3 };
  const recreated = { ...page, createdAt: "2026-02-01T00:00:00Z" };

  test("a recreated page is newer than the deleted one at any revision", () => {
    expect(isOlderPage(deleted, recreated)).toBe(true);
    expect(isOlderPage(recreated, deleted)).toBe(false);
    expect(isOlderPage(page, deleted)).toBe(true);
    expect(isOlderPage(deleted, { ...deleted, id: "p2" })).toBe(false);
  });

  test("a recreated page replaces the cached deleted page", async () => {
    const queryClient = new QueryClient();
    const query = wikiPageQuery(wiki, page.path);

    spyOn(globalThis, "fetch").mockResolvedValue(Response.json(recreated));
    queryClient.setQueryData(query.queryKey, deleted);
    await queryClient.query({ ...query, staleTime: 0 });

    expect(queryClient.getQueryData(query.queryKey)).toMatchObject({
      createdAt: recreated.createdAt,
      revision: 1,
    });
  });

  test("a late refetch of the deleted page keeps the recreated one", async () => {
    const queryClient = new QueryClient();
    const query = wikiPageQuery(wiki, page.path);

    spyOn(globalThis, "fetch").mockResolvedValue(Response.json(deleted));
    queryClient.setQueryData(query.queryKey, recreated);
    await queryClient.query({ ...query, staleTime: 0 });

    expect(queryClient.getQueryData(query.queryKey)?.createdAt).toBe(
      recreated.createdAt
    );
  });

  test("a write after a recreate retries on the recreated revision", async () => {
    const queryClient = new QueryClient();
    const revisions: number[] = [];

    queryClient.setQueryData(wikiPageQuery(wiki, page.path).queryKey, deleted);
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = v.parse(
            BodySchema,
            await new Response(init?.body).json()
          );

          revisions.push(body.baseRevision);

          return body.baseRevision === 1
            ? Response.json({ ...recreated, body: "mine", revision: 2 })
            : conflict(recreated);
        },
        { preconnect: fetch.preconnect }
      )
    );

    expect(await write(queryClient, "body", "mine", "old body", deleted)).toBe(
      "saved:mine:r2"
    );
    expect(revisions).toEqual([3, 1]);
  });

  test("repeated conflicts stop retrying and report the conflict", async () => {
    const queryClient = new QueryClient();

    const fetches = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => await Promise.resolve(conflict(page)), {
        preconnect: fetch.preconnect,
      })
    );

    expect(await write(queryClient, "body", "mine", "old body")).toBe(
      "conflict:old body"
    );
    expect(fetches).toHaveBeenCalledTimes(4);
  });

  test("a write to a replaced page fails and caches the replacement", async () => {
    const queryClient = new QueryClient();
    const replacement = { ...page, body: "new page", id: "p2", revision: 1 };

    spyOn(globalThis, "fetch").mockResolvedValue(conflict(replacement));

    expect(await write(queryClient, "body", "mine", "old body")).toBe(
      "error:Another page now uses guides/setup"
    );
    expect(
      queryClient.getQueryData(wikiPageQuery(wiki, page.path).queryKey)?.id
    ).toBe("p2");
  });
});

test("wikiDraftText returns unsaved text until the draft is gone", () => {
  const key = `${wikiDraftId("p9")}:body`;

  expect(wikiDraftText("p9", "body")).toBeUndefined();
  editDraft(key, "typed", "saved");
  expect(wikiDraftText("p9", "body")).toBe("typed");
  expect(wikiDraftText("p9", "title")).toBeUndefined();
  discardDraft(key);
  expect(wikiDraftText("p9", "body")).toBeUndefined();
});

test("pathProblem names what makes a path invalid", () => {
  expect(pathProblem("")).toBeNull();
  expect(pathProblem("guides/setup-2.1_x")).toBeNull();
  expect(pathProblem("bad path!")).toBe("A path cannot contain spaces, “!”.");
  expect(pathProblem("ünï")).toBe("A path cannot contain “ü”, “ï”.");

  for (const path of ["/guides", "guides/", "a//b"]) {
    expect(pathProblem(path)).toBe(
      "Remove the empty part between the “/” characters."
    );
  }

  for (const path of ["-x", "a/_b", "a/.b"]) {
    expect(pathProblem(path)).toBe(
      "Start each part of the path with a letter or digit."
    );
  }
});

describe("replaced page", () => {
  const replacement = { ...page, body: "alice", id: "p2" };
  const base = { kept: null };

  test("an editor with a draft keeps its page when another takes the path", () => {
    expect(
      keptPage({ ...base, dirty: true, fetched: replacement, shown: page })
    ).toBe(page);
  });

  test("an editor without a draft follows the new page", () => {
    expect(
      keptPage({ ...base, dirty: false, fetched: replacement, shown: page })
    ).toBeNull();
  });

  test("a move or a refetch of the same page never keeps the old copy", () => {
    expect(
      keptPage({
        ...base,
        dirty: true,
        fetched: { ...page, revision: 2 },
        shown: page,
      })
    ).toBeNull();
    expect(
      keptPage({
        ...base,
        dirty: true,
        fetched: { ...replacement, path: "elsewhere" },
        shown: page,
      })
    ).toBeNull();
  });

  test("another workspace's page at the same path is never a replacement", () => {
    const other = { ...page, id: "b1", workspaceSlug: "globex" };
    const state = { kept: null, key: "w1:guide", shown: page };

    const switched = nextKept(state, "w2:guide", other, true);

    expect(switched).toEqual({ kept: null, key: "w2:guide", shown: other });
    expect(switched && nextKept(switched, "w2:guide", other, true)).toBeNull();
    expect(nextKept(state, "w1:guide", replacement, true)?.kept).toBe(page);
    expect(nextKept(state, "w1:guide", page, true)).toBeNull();
  });

  test("a kept page stays whatever the path query returns next", () => {
    const kept = { dirty: false, kept: page, shown: replacement };

    expect(keptPage({ ...kept, fetched: replacement })).toBe(page);
    expect(keptPage({ ...kept, fetched: { ...page, revision: 9 } })).toBe(page);
  });

  test("a kept page survives a workspace slug change", () => {
    const key = keptKey(wiki, page.path);

    storeKept(key, page);

    expect(
      readKept(keptKey({ ...wiki, slug: "acme-renamed" }, page.path))
    ).toBe(page);
    expect(readKept(keptKey({ ...wiki, workspaceId: "w2" }, page.path))).toBe(
      null
    );
    storeKept(key, null);
    expect(readKept(key)).toBeNull();
  });

  test("freePath trims the last segment to stay within 200 characters", () => {
    const long = `guides/${"x".repeat(193)}`;
    const copy = freePath(long, new Set([long]));

    expect(copy).toHaveLength(200);
    expect(copy).toBe(`guides/${"x".repeat(188)}-copy`);
    expect(freePath(long, new Set([long, copy]))).toBe(
      `guides/${"x".repeat(186)}-copy-2`
    );
  });

  test("freePath picks the first unused copy path", () => {
    expect(freePath("a", new Set(["a"]))).toBe("a-copy");
    expect(freePath("a", new Set(["a", "a-copy", "a-copy-2"]))).toBe(
      "a-copy-3"
    );
  });
});

test("two rescues of the same page each get a new id and a free path", async () => {
  const created = new Map<string, string>();

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const path = url.slice(url.indexOf("/wiki/") + "/wiki/".length);

        const { id } = v.parse(
          v.object({ id: v.string() }),
          await new Response(init?.body).json()
        );

        if (created.has(path)) {
          return conflict({ ...page, path });
        }

        created.set(path, id);

        return Response.json({ ...page, id, path });
      },
      { preconnect: fetch.preconnect }
    )
  );

  const content = { body: "draft", title: "Setup" };
  const taken = new Set([page.path]);
  const first = await saveAsNewPage(wiki, page.path, content, taken);
  const second = await saveAsNewPage(wiki, page.path, content, taken);

  expect([first.path, second.path]).toEqual([
    "guides/setup-copy",
    "guides/setup-copy-2",
  ]);
  expect(new Set([page.id, first.id, second.id]).size).toBe(3);
});
