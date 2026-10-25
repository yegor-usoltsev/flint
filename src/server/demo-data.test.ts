import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { Route as workspacesRoute } from "~/routes/api/v1/workspaces/index";
import { db } from "~/server/db.server";
import { s3 } from "~/server/s3.server";

import {
  callApi,
  createUser,
  resetDatabase,
  sessionCookieFor,
} from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  mock.restore();
});

const create = async (
  cookie: string,
  slug: string,
  name: string,
  demo: boolean | null = true
) =>
  await callApi(workspacesRoute, cookie, "POST", "/api/v1/workspaces", {
    body: { demo: demo ?? undefined, name, slug },
  });

const contentOf = async (slug: string) => {
  const projects = await db<{ key: string; name: string }[]>`
    select p.key, p.name from projects p
    join workspaces w on w.id = p.workspace_id
    where w.slug = ${slug}
    order by p.key
  `;

  const issues = await db<{ assignee: string; key: string; title: string }[]>`
    select p.key || '-' || i.number as key, i.title, u.username as assignee
    from issues i
    join projects p on p.id = i.project_id
    join workspaces w on w.id = p.workspace_id
    join users u on u.id = i.assignee_id
    where w.slug = ${slug}
    order by i.number
  `;

  const pages = await db<{ body: string; path: string; title: string }[]>`
    select wp.path, wp.title, wp.body_md as body from wiki_pages wp
    join workspaces w on w.id = wp.workspace_id
    where w.slug = ${slug}
  `;

  const [files] = await db<{ count: number }[]>`
    select count(*)::int as count from attachments a
    join workspaces w on w.id = a.workspace_id
    where w.slug = ${slug}
  `;

  return {
    files: files?.count,
    issues: [...issues],
    pages: [...pages],
    projects: [...projects],
  };
};

test("demo data adds a Getting started project with steps and a guide with screenshots", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));

  expect(await create(alice, "acme", "Acme Corp")).toMatchObject({
    status: 201,
  });

  const { files, issues, pages, projects } = await contentOf("acme");

  expect(projects).toEqual([{ key: "AC", name: "Getting started" }]);
  expect(issues.map(({ key }) => key)).toEqual([
    "AC-1",
    "AC-2",
    "AC-3",
    "AC-4",
    "AC-5",
  ]);
  expect(issues.every(({ assignee }) => assignee === "alice")).toBe(true);

  const recent = await db<{ number: number }[]>`
    select number from issues order by updated_at desc
  `;

  expect(recent.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5]);
  expect(files).toBe(4);
  expect(pages).toHaveLength(1);
  expect(pages[0]?.title).toBe("Getting started with Flint");
  expect(pages[0]?.body.match(/!\[[^\]]+\]\(\/files\/[\w-]+\)/gu)).toHaveLength(
    4
  );
  expect(pages[0]?.body).toContain("alice/AC-4-link-a-pull-request");
});

test("a workspace without demo data starts empty", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));

  expect(await create(alice, "acme", "Acme Corp", null)).toMatchObject({
    status: 201,
  });
  expect(await contentOf("acme")).toEqual({
    files: 0,
    issues: [],
    pages: [],
    projects: [],
  });
});

test("workspaces with the same name get distinct keys, even when created at once", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));

  const responses = await Promise.all(
    ["one", "two", "three"].map(
      async (slug) => await create(alice, slug, "Acme Corp")
    )
  );

  expect(responses.map(({ status }) => status)).toEqual([201, 201, 201]);

  const keys = await Promise.all(
    ["one", "two", "three"].map(async (slug) => {
      const { issues, pages, projects } = await contentOf(slug);
      const key = projects[0]?.key ?? "";

      expect(issues[0]?.key).toBe(`${key}-1`);
      expect(pages[0]?.body).toContain(`${key}-1`);

      return key;
    })
  );

  expect(keys.toSorted()).toEqual(["AC", "AC2", "AC3"]);
});

test("the key keeps five characters and falls back when the name has no letters", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));

  await create(alice, "a", "Alpha Beta Gamma Delta Echo");
  await create(alice, "b", "Alpha Beta Gamma Delta Echo");
  await create(alice, "c", "42");

  const keys = await db<
    { key: string }[]
  >`select key from projects order by key`;

  expect(keys.map(({ key }) => key)).toEqual(["ABGD2", "ABGDE", "START"]);
});

test("a taken slug creates nothing more, and a failed seed leaves no workspace", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));

  await create(alice, "acme", "Acme Corp");

  const before = await contentOf("acme");

  expect(await create(alice, "acme", "Acme Corp")).toMatchObject({
    status: 409,
  });
  expect(await contentOf("acme")).toEqual(before);

  spyOn(s3, "write").mockRejectedValue(new Error("storage is down"));

  expect(await create(alice, "globex", "Globex")).toMatchObject({
    status: 500,
  });

  const [left] = await db<{ count: number }[]>`
    select count(*)::int as count from workspaces where slug = 'globex'
  `;

  expect(left?.count).toBe(0);
});
