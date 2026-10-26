import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { Route as searchRoute } from "~/routes/api/v1/workspaces/$slug/search";
import { db } from "~/server/db.server";
import {
  backfillEmbeddings,
  embed,
  settleEmbeddings,
} from "~/server/embeddings.server";
import { env } from "~/server/env.server";
import { createIssue, updateIssue } from "~/server/issues.server";
import { createProject } from "~/server/projects.server";
import { putPage } from "~/server/wiki.server";
import { createWorkspace } from "~/server/workspaces.server";

import {
  callApi,
  createUser,
  resetDatabase,
  sessionCookieFor,
  stubGiteaUsers,
} from "../../test/helpers";

const live = process.env["LIVE_EMBEDDINGS"] === "1";
const savedKey = env.EMBEDDING_API_KEY;
const savedUrl = env.EMBEDDING_API_URL;

const concepts = [
  ["login", "sign in", "вход", "войти"],
  ["cache", "кэш"],
  ["payment", "оплат"],
];

const vectorFor = (text: string) => {
  const lower = text.toLowerCase();

  const vector = Array.from({ length: 1024 }, (_, index): number =>
    concepts[index]?.some((word) => lower.includes(word)) === true ? 1 : 0
  );

  vector[1023] = 0.1;

  return vector;
};

const BodySchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ input: v.array(v.string()) })
);

const stubEmbeddings = (failures = 0) => {
  const spy = stubGiteaUsers();
  const gitea = spy.getMockImplementation();
  const calls: string[][] = [];
  let failed = 0;

  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (!url.startsWith("https://embeddings.test/")) {
      return gitea === undefined
        ? Response.json({}, { status: 404 })
        : await gitea(input, init);
    }

    if (failed < failures) {
      failed += 1;

      return Response.json({ error: "busy" }, { status: 503 });
    }

    const { input: texts } = v.parse(BodySchema, init?.body);

    calls.push(texts);

    return Response.json({
      data: texts.map((text, index) => ({ embedding: vectorFor(text), index })),
    });
  };

  spy.mockImplementation(Object.assign(fake, { preconnect: fetch.preconnect }));

  return calls;
};

beforeEach(async () => {
  await resetDatabase();
  env.EMBEDDING_API_KEY = live ? savedKey : "test-key";
});

afterEach(async () => {
  await settleEmbeddings();
  mock.restore();
  env.EMBEDDING_API_KEY = savedKey;
});

const issue = (title: string, description = "") => ({
  assigneeId: null,
  description,
  labelIds: [],
  priority: 0 as const,
  title,
});

const setup = async () => {
  const rootId = await createUser("root");
  const root = { userId: rootId };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });

  return { auth: await sessionCookieFor(rootId), root };
};

const SearchSchema = v.object({
  issues: v.array(v.looseObject({ key: v.string() })),
  pages: v.array(v.looseObject({ path: v.string() })),
  semantic: v.boolean(),
});

const search = async (auth: string, query: string) => {
  const response = await callApi(
    searchRoute,
    auth,
    "GET",
    `/api/v1/workspaces/acme/search?${query}`,
    { params: { slug: "acme" } }
  );

  const results = v.parse(SearchSchema, response.body);

  return {
    issues: results.issues.map(({ key }) => key),
    pages: results.pages.map(({ path }) => path),
    semantic: results.semantic,
  };
};

test.skipIf(live)(
  "hybrid search adds meaning-based hits to full-text ones; fts mode stays lexical",
  async () => {
    stubEmbeddings();
    const { auth, root } = await setup();

    await createIssue(root, "ENG", issue("Fix login redirect"));
    await createIssue(root, "ENG", issue("Cache warmup is slow"));
    await createIssue(root, "ENG", issue("Redirect loop on logout"));
    await putPage(
      root,
      { path: "payments", slug: "acme" },
      { body: "How payment webhooks retry" }
    );
    await settleEmbeddings();

    expect(await search(auth, "q=вход&mode=fts")).toEqual({
      issues: [],
      pages: [],
      semantic: false,
    });
    expect(await search(auth, "q=вход")).toEqual({
      issues: ["ENG-1"],
      pages: [],
      semantic: true,
    });
    expect(await search(auth, "q=оплата&type=wiki")).toEqual({
      issues: [],
      pages: ["payments"],
      semantic: true,
    });

    const redirect = await search(auth, "q=redirect");

    expect(redirect.issues.toSorted()).toEqual(["ENG-1", "ENG-3"]);
    const byKey = await search(auth, "q=eng-3");

    expect(byKey.issues[0]).toBe("ENG-3");
  }
);

test.skipIf(live)(
  "semantic search fills its candidate limit within a workspace despite closer foreign vectors",
  async () => {
    stubEmbeddings();
    const { auth, root } = await setup();

    env.EMBEDDING_API_KEY = "";

    const seed = await createIssue(root, "ENG", issue("Seed"));

    const page = await putPage(
      root,
      { path: "seed", slug: "acme" },
      { body: "Seed" }
    );

    await createWorkspace(root, { name: "Other", slug: "other" });
    await createProject(root, "other", {
      color: "blue",
      key: "OTHER",
      name: "Other",
    });
    await db`
      insert into issues (
        id, project_id, number, title, status_id, creator_id, sort_key,
        embedding, embedding_model, deleted_at
      )
      select uuidv7(), p.id, g + 1, 'Candidate ' || g,
        (select id from statuses where project_id = p.id limit 1),
        i.creator_id, 'a0',
        (array[1.0, case when p.key = 'ENG' and g <= 64 then 0.1 + g / 1000.0 else 0 end]
          || array_fill(0.0, array[1021]) || array[0.1])::vector,
        case when p.key = 'ENG' and g > 74 then 'old-model'
          else ${env.EMBEDDING_MODEL} end,
        case when p.key = 'ENG' and g between 65 and 74 then now() end
      from projects p cross join generate_series(1, 10000) g
      cross join issues i
      where i.id = ${seed.id} and (p.key = 'OTHER' or g <= 84)
    `;
    await db`
      insert into wiki_pages (
        id, workspace_id, kind, path, sort_key, title, updated_by,
        embedding, embedding_model, deleted_at
      )
      select uuidv7(), w.id,
        case when w.slug = 'acme' and g > 84 then 'folder' else 'page' end,
        'candidate-' || g, 'a0', 'Candidate ' || g, ${root.userId},
        (array[1.0, case when w.slug = 'acme' and g <= 64 then 0.1 + g / 1000.0 else 0 end]
          || array_fill(0.0, array[1021]) || array[0.1])::vector,
        case when w.slug = 'acme' and g between 75 and 84 then 'old-model'
          else ${env.EMBEDDING_MODEL} end,
        case when w.slug = 'acme' and g between 65 and 74 then now() end
      from workspaces w cross join generate_series(1, 10000) g
      where w.slug = 'other' or g <= 94
    `;
    await db`delete from issues where id = ${seed.id}`;
    await db`delete from wiki_pages where id = ${page.id}`;
    await db`analyze issues`;
    await db`analyze projects`;
    await db`analyze wiki_pages`;
    env.EMBEDDING_API_KEY = "test-key";

    expect(await search(auth, "q=вход&limit=50")).toEqual({
      issues: Array.from({ length: 50 }, (_, index) => `ENG-${index + 2}`),
      pages: Array.from({ length: 50 }, (_, index) => `candidate-${index + 1}`),
      semantic: true,
    });
    expect(await search(auth, "q=вход&limit=1&type=wiki")).toEqual({
      issues: [],
      pages: ["candidate-1"],
      semantic: true,
    });
  },
  60_000
);

test.skipIf(live)(
  "keys, one- and two-character queries and one-word queries with text matches stay lexical",
  async () => {
    stubEmbeddings();
    const { auth, root } = await setup();

    await createIssue(root, "ENG", issue("Fix login redirect"));
    await createIssue(root, "ENG", issue("Users cannot sign in"));
    await createIssue(root, "ENG", issue("Archive the legacy importer"));
    await settleEmbeddings();

    expect(await search(auth, "q=zz")).toEqual({
      issues: [],
      pages: [],
      semantic: false,
    });
    expect(await search(auth, "q=eng-9")).toEqual({
      issues: [],
      pages: [],
      semantic: false,
    });
    expect(await search(auth, "q=ENG-3")).toEqual({
      issues: ["ENG-3"],
      pages: [],
      semantic: false,
    });
    expect(await search(auth, "q=login")).toEqual({
      issues: ["ENG-1"],
      pages: [],
      semantic: true,
    });
    const synonyms = await search(auth, "q=вход");

    expect(synonyms.issues.toSorted()).toEqual(["ENG-1", "ENG-2"]);
  }
);

test.skipIf(live)("scores rank issues and pages on one scale", async () => {
  stubEmbeddings();
  const { auth, root } = await setup();

  await createIssue(root, "ENG", issue("Оплата не проходит"));
  await createIssue(root, "ENG", issue("Cache warmup is slow"));
  await putPage(
    root,
    { path: "payments", slug: "acme" },
    { body: "How payment webhooks retry" }
  );
  await settleEmbeddings();

  const response = await callApi(
    searchRoute,
    auth,
    "GET",
    "/api/v1/workspaces/acme/search?q=payment%20webhooks",
    { params: { slug: "acme" } }
  );

  const { issues, pages } = v.parse(
    v.object({
      issues: v.array(v.object({ key: v.string(), score: v.number() })),
      pages: v.array(v.object({ path: v.string(), score: v.number() })),
    }),
    response.body
  );

  expect(pages.map(({ path }) => path)).toEqual(["payments"]);
  expect(issues.map(({ key }) => key)).toEqual(["ENG-1"]);
  expect(pages[0]?.score).toBeGreaterThan(issues[0]?.score ?? 1);
});

test.skipIf(live)(
  "embeddings follow text changes only, retry failures and backfill",
  async () => {
    const calls = stubEmbeddings(1);
    const { root } = await setup();
    const created = await createIssue(root, "ENG", issue("Fix login"));

    await settleEmbeddings();
    expect(calls).toEqual([["Fix login\n\n"]]);

    await updateIssue(root, created.key, { priority: 2 });
    await settleEmbeddings();
    expect(calls).toHaveLength(1);

    await updateIssue(root, created.key, { description: "Cookie expires" });
    await settleEmbeddings();
    expect(calls.at(-1)).toEqual(["Fix login\n\nCookie expires"]);

    await db`update issues set embedding = null, embedding_hash = null`;
    expect(await backfillEmbeddings()).toBe(1);
    expect(await backfillEmbeddings()).toBe(0);

    const [row] = await db<{ model: string | null }[]>`
      select embedding_model as model from issues where embedding is not null
    `;

    expect(row?.model).toBe(env.EMBEDDING_MODEL);
  }
);

test.skipIf(live)(
  "the embeddings URL works with and without a trailing slash",
  async () => {
    const urls: string[] = [];

    stubGiteaUsers().mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          urls.push(new Request(input).url);

          return await Promise.resolve(
            Response.json({
              data: [{ embedding: vectorFor("login"), index: 0 }],
            })
          );
        },
        { preconnect: fetch.preconnect }
      )
    );

    try {
      for (const base of [
        "https://embeddings.test/v1",
        "https://embeddings.test/v1//",
      ]) {
        env.EMBEDDING_API_URL = base;
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each base URL needs its own request.
        await embed(["login"], []);
      }
    } finally {
      env.EMBEDDING_API_URL = savedUrl;
    }

    expect(urls).toEqual([
      "https://embeddings.test/v1/embeddings",
      "https://embeddings.test/v1/embeddings",
    ]);
  }
);

test.skipIf(live)(
  "a model with other dimensions fails with a clear error",
  async () => {
    stubGiteaUsers().mockResolvedValue(
      Response.json({ data: [{ embedding: [0.1, 0.2], index: 0 }] })
    );

    const [result] = await Promise.allSettled([embed(["Fix login"], [])]);

    expect(result).toMatchObject({
      reason: {
        message: `Embedding model ${env.EMBEDDING_MODEL} returned 2 dimensions; Flint needs 1024`,
      },
      status: "rejected",
    });
  }
);

test.skipIf(live)(
  "without a key or when the query cannot be embedded, search is full-text only",
  async () => {
    const calls = stubEmbeddings(5);
    const { auth, root } = await setup();

    env.EMBEDDING_API_KEY = "";
    await createIssue(root, "ENG", issue("Fix login"));
    await settleEmbeddings();
    expect(await search(auth, "q=login")).toEqual({
      issues: ["ENG-1"],
      pages: [],
      semantic: false,
    });

    env.EMBEDDING_API_KEY = "test-key";
    expect(await search(auth, "q=login")).toEqual({
      issues: ["ENG-1"],
      pages: [],
      semantic: false,
    });
    expect(calls).toEqual([]);
  }
);

test.skipIf(live)(
  "a stalled provider falls back to full-text within the query budget",
  async () => {
    const { auth, root } = await setup();

    env.EMBEDDING_API_KEY = "";
    await createIssue(root, "ENG", issue("Fix login"));
    env.EMBEDDING_API_KEY = "test-key";

    const stalled = Bun.serve({
      fetch: async (request) => {
        if (new URL(request.url).pathname.startsWith("/headers")) {
          await Promise.withResolvers<never>().promise;
        }

        return new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode('{"data":['));
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      },
      port: 0,
    });

    try {
      for (const stage of ["headers", "body"]) {
        env.EMBEDDING_API_URL = `${stalled.url.origin}/${stage}`;

        const started = performance.now();

        // oxlint-disable-next-line eslint/no-await-in-loop -- Stages share one stalled server.
        expect(await search(auth, "q=login")).toEqual({
          issues: ["ENG-1"],
          pages: [],
          semantic: false,
        });
        expect(performance.now() - started).toBeLessThan(3000);
      }
    } finally {
      env.EMBEDDING_API_URL = savedUrl;
      await stalled.stop(true);
    }
  }
);

test.skipIf(!live)(
  "live: a Russian query finds an English issue",
  async () => {
    stubGiteaUsers().mockRestore();
    const { auth, root } = await setup();

    await createIssue(
      root,
      "ENG",
      issue("Users cannot sign in after a password reset")
    );
    await createIssue(root, "ENG", issue("Cache warmup is slow on cold start"));
    await createIssue(root, "ENG", issue("Payment webhook retries pile up"));
    await settleEmbeddings();

    const fts = await search(auth, "q=не могу войти в аккаунт&mode=fts");
    const hybrid = await search(auth, "q=не могу войти в аккаунт");

    console.info("live search", { fts, hybrid });
    expect(fts.issues).toEqual([]);
    expect(hybrid.issues[0]).toBe("ENG-1");
  },
  30_000
);

test.skipIf(!live)(
  "live: a short query keeps to the rows that match it",
  async () => {
    stubGiteaUsers().mockRestore();
    const { auth, root } = await setup();

    await createIssue(root, "ENG", issue("Добавить экспорт в CSV"));
    await createIssue(root, "ENG", issue("Slow wiki load"));
    await putPage(
      root,
      { path: "guides/setup", slug: "acme" },
      { body: "Install Bun and start the stack.", title: "Setup guide" }
    );
    await settleEmbeddings();

    const csv = await search(auth, "q=export");
    const setupQuery = await search(auth, "q=setup");
    const missingKey = await search(auth, "q=OPS-1");

    console.info("live search", { csv, missingKey, setupQuery });
    expect(setupQuery).toEqual({
      issues: [],
      pages: ["guides/setup"],
      semantic: true,
    });
    expect(missingKey).toEqual({ issues: [], pages: [], semantic: false });
    expect(csv.issues).toEqual(["ENG-1"]);
  },
  30_000
);
