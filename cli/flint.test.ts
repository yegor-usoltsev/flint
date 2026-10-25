import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { setChecklistItem } from "../src/lib/checklist.ts";
import { changes, linkFile, workspaceOf, writeConfig } from "./client.ts";
import type { Json } from "./client.ts";
import { complete, createProgram, main } from "./program.ts";
import { treeRows } from "./wiki.ts";

type Answer = (request: Request) => Promise<Response> | Response;

const FieldsSchema = v.partial(
  v.object({
    description: v.string(),
    labelIds: v.array(v.string()),
    priority: v.number(),
    statusId: v.string(),
    version: v.number(),
  })
);

type Fields = v.InferOutput<typeof FieldsSchema>;

let requests: string[] = [];
let printed: string[] = [];

const stubApi = (answers: Record<string, Answer>) => {
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const route = `${request.method} ${new URL(request.url).pathname.replace("/api/v1", "")}`;

    requests.push(`${route} ${await request.clone().text()}`.trim());

    const answer = answers[route];

    if (answer === undefined) {
      return Response.json(
        { error: { code: "not_found", message: route } },
        { status: 404 }
      );
    }

    return await answer(request);
  };

  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fake, { preconnect: fetch.preconnect })
  );
};

const flint = async (...argv: string[]) => {
  printed = [];

  return await main(argv);
};

beforeEach(() => {
  requests = [];
  printed = [];
  spyOn(console, "log").mockImplementation((line: string) => {
    printed.push(line);
  });
  spyOn(console, "error").mockImplementation((line: string) => {
    printed.push(line);
  });
  Object.assign(process.env, {
    FLINT_TOKEN: "t",
    FLINT_URL: "http://flint.test",
  });
});

afterEach(() => {
  mock.restore();
  delete process.env["FLINT_TOKEN"];
  delete process.env["FLINT_URL"];
});

const issue = (key: string, fields: Fields = {}) => ({
  assigneeId: null,
  deletedAt: null,
  description: "",
  key,
  labelIds: ["a"],
  links: [],
  priority: 0,
  statusId: "s",
  title: "T",
  version: 5,
  ...fields,
});

const reply =
  (body: Json, status = 200): Answer =>
  () =>
    Response.json(body, { status });

const echo =
  (key: string): Answer =>
  async (request) =>
    Response.json(issue(key, v.parse(FieldsSchema, await request.json())));

const project = reply({
  key: "ENG",
  statuses: [{ id: "s", name: "Todo" }],
  workspaceSlug: "acme",
});

const labels = reply([
  { id: "a", name: "Bug" },
  { id: "b", name: "Docs" },
]);

test("checklist items toggle by number or text outside code fences", () => {
  const markdown =
    "- [ ] Write tests\n```\n- [ ] not a task\n```\n* [x] Ship it";

  expect(setChecklistItem(markdown, "1", true)).toEqual({
    markdown: "- [x] Write tests\n```\n- [ ] not a task\n```\n* [x] Ship it",
  });
  expect(setChecklistItem(markdown, "ship", false)).toEqual({
    markdown: "- [ ] Write tests\n```\n- [ ] not a task\n```\n* [ ] Ship it",
  });
  expect(setChecklistItem(markdown, "not a task", true)).toEqual({
    matches: [],
  });
  expect(setChecklistItem(markdown, "3", true)).toEqual({ matches: [] });
});

test("a text that matches several items picks the one the change applies to, or lists them", () => {
  const markdown = "- [x] alpha one\n- [ ] alpha two\n- [ ] beta alpha";

  expect(
    setChecklistItem("- [x] alpha one\n- [ ] alpha two", "alpha", true)
  ).toEqual({
    markdown: "- [x] alpha one\n- [x] alpha two",
  });
  expect(setChecklistItem(markdown, "alpha", false)).toEqual({
    markdown: "- [ ] alpha one\n- [ ] alpha two\n- [ ] beta alpha",
  });
  expect(setChecklistItem(markdown, "alpha", true)).toEqual({
    matches: [
      { done: true, number: 1, text: "alpha one" },
      { done: false, number: 2, text: "alpha two" },
      { done: false, number: 3, text: "beta alpha" },
    ],
  });
});

test("an ambiguous checklist text is a usage error that lists the matches", async () => {
  stubApi({
    "GET /issues/ENG-1": reply(
      issue("ENG-1", { description: "- [ ] alpha one\n- [ ] alpha two" })
    ),
    "GET /projects/ENG": project,
  });

  expect(await flint("issue", "check", "ENG-1", "alpha")).toBe(2);
  expect(JSON.parse(printed.join(""))).toEqual({
    error: {
      code: "usage",
      message:
        "“alpha” matches 2 checklist items in ENG-1: 1 [ ] alpha one; 2 [ ] alpha two; pass the number",
    },
  });
  expect(requests.some((line) => line.startsWith("PATCH"))).toBe(false);
});

test("the stored token is readable only by its owner, also over an existing file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flint-config-"));
  const fresh = path.join(directory, "new", "config.json");
  const existing = path.join(directory, "config.json");

  await Bun.write(existing, "{}", { mode: 0o644 });
  await writeConfig({ token: "secret", url: "http://flint.test" }, fresh);
  await writeConfig({ token: "secret", url: "http://flint.test" }, existing);

  const modes = await Promise.all(
    [fresh, existing].map(async (file) => {
      const info = await stat(file);

      return info.mode % 0o1000;
    })
  );

  expect(modes).toEqual([0o600, 0o600]);
  expect(await Bun.file(existing).json()).toEqual({
    token: "secret",
    url: "http://flint.test",
  });
  await rm(directory, { force: true, recursive: true });
});

test("adding and removing labels sends only the change, so a concurrent label survives", async () => {
  stubApi({
    "GET /projects/ENG": project,
    "GET /workspaces/acme/labels": labels,
    "PATCH /issues/ENG-1": echo("ENG-1"),
  });

  expect(
    await flint(
      "issue",
      "update",
      "ENG-1",
      "--add-label",
      "Docs",
      "--remove-label",
      "Bug"
    )
  ).toBe(0);
  expect(requests.at(-1)).toBe(
    'PATCH /issues/ENG-1 {"addLabelIds":["b"],"removeLabelIds":["a"]}'
  );

  expect(await flint("issue", "update", "ENG-1", "--label", "Docs")).toBe(0);
  expect(requests.at(-1)).toBe('PATCH /issues/ENG-1 {"labelIds":["b"]}');
});

test("an unknown label name lists the workspace's labels", async () => {
  stubApi({
    "GET /projects/ENG": project,
    "GET /workspaces/acme/labels": labels,
  });

  expect(await flint("issue", "update", "ENG-1", "--add-label", "Nope")).toBe(
    2
  );
  expect(JSON.parse(printed.join(""))).toEqual({
    error: {
      code: "usage",
      message: "Unknown label “Nope”; use one of: Bug, Docs",
    },
  });
});

test("a bulk update changes every issue and reports the ones that failed", async () => {
  stubApi({
    "GET /projects/ENG": project,
    "PATCH /issues/ENG-1": echo("ENG-1"),
    "PATCH /issues/ENG-2": echo("ENG-2"),
  });

  expect(
    await flint(
      "issue",
      "update",
      "ENG-1",
      "ENG-2",
      "-s",
      "todo",
      "--priority",
      "high"
    )
  ).toBe(0);
  expect(JSON.parse(printed.join(""))).toMatchObject([
    { key: "ENG-1", priority: 2, statusId: "s" },
    { key: "ENG-2", priority: 2, statusId: "s" },
  ]);

  expect(
    await flint("issue", "update", "ENG-1", "ENG-9", "--priority", "low")
  ).toBe(1);
  expect(JSON.parse(printed.join(""))).toMatchObject({
    error: {
      code: "bulk_failed",
      failed: [
        {
          key: "ENG-9",
          response: { error: { code: "not_found" } },
        },
      ],
    },
    issues: ["ENG-1"],
  });
});

test("deleting an issue that is already deleted fails with the API's deleted error", async () => {
  stubApi({
    "DELETE /issues/ENG-1": reply(
      {
        error: {
          code: "deleted",
          current: issue("ENG-1", {}),
          message: "ENG-1 is already deleted",
        },
      },
      409
    ),
    "GET /projects/ENG": project,
  });

  expect(await flint("issue", "delete", "ENG-1", "--yes")).toBe(1);
  expect(JSON.parse(printed.join(""))).toMatchObject({
    error: { code: "deleted", message: "ENG-1 is already deleted" },
  });
});

test("usage errors exit 2 before any request", async () => {
  stubApi({});

  for (const argv of [
    ["issue", "frobnicate"],
    ["issue"],
    ["issue", "update", "ENG-1"],
    ["issue", "update", "ENG-1", "ENG-2", "-t", "x"],
    ["issue", "update", "ENG-1", "--priority", "huge"],
    ["issue", "create", "-t", "x", "--if-version", "1"],
    ["wiki", "delete", "a", "b", "--yes"],
    ["wiki", "get"],
    ["wiki", "delete", "a"],
    ["whoami", "extra"],
    ["completion", "powershell"],
    ["issue", "update", "ENG-1", "-t", " "],
    ["issue", "create", "-p", "ENG", "-t", ""],
    ["issue", "update", "ENG-1", "-l", "Bug", "--add-label", "Docs"],
    ["workspace", "view", "acme", "-w", "acme"],
    ["attachment", "list"],
    ["attachment", "list", "ENG-1", "-i", "ENG-1"],
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each case reuses the same console spy.
    expect(await flint(...argv)).toBe(2);
    expect(JSON.parse(printed.join(""))).toMatchObject({
      error: { code: "usage" },
    });
  }

  expect(requests).toEqual([]);
});

test("usage errors explain the likely mistake", async () => {
  stubApi({});

  for (const [argv, message] of [
    [
      ["issue", "status", "ENG-1", "Done"],
      "Unknown status “ENG-1”; the status comes first: flint issue status <status> <keys...>",
    ],
    [["issue", "update", "ENG-1", "-t", ""], "The title must not be empty"],
    [
      ["issue", "show", "ENG-1"],
      "unknown command 'show'\n(Did you mean issue view?)",
    ],
    [
      ["issue", "close", "ENG-1"],
      "unknown command 'close'\n(Did you mean issue status Done <keys...>?)",
    ],
    [["wiki", "show", "a"], "unknown command 'show'\n(Did you mean wiki get?)"],
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each case reuses the same console spy.
    expect(await flint(...argv)).toBe(2);
    expect(JSON.parse(printed.join(""))).toEqual({
      error: { code: "usage", message },
    });
  }

  expect(requests).toEqual([]);
});

test("workspace view and attachment list take the slug and key as arguments", async () => {
  stubApi({
    "GET /issues/ENG-1/attachments": reply([]),
    "GET /workspaces/acme": reply({ slug: "acme" }),
  });

  expect(await flint("workspace", "view", "acme")).toBe(0);
  expect(await flint("attachment", "list", "ENG-1")).toBe(0);
  expect(requests).toEqual([
    "GET /workspaces/acme",
    "GET /issues/ENG-1/attachments",
  ]);
});

test("a value that starts with a dash is kept as the value", async () => {
  stubApi({
    "GET /projects/ENG": project,
    "PATCH /issues/ENG-1": echo("ENG-1"),
  });

  expect(await flint("issue", "update", "ENG-1", "-d", "- [ ] task")).toBe(0);
  expect(requests.at(-1)).toBe(
    'PATCH /issues/ENG-1 {"description":"- [ ] task"}'
  );
});

test("an explicit project picks its workspace over the link file; a contradicting -w is a usage error", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flint-link-"));
  const cwd = process.cwd();

  stubApi({
    "GET /projects/OPS": reply({ key: "OPS", workspaceSlug: "globex" }),
  });
  await Bun.write(
    path.join(directory, linkFile),
    JSON.stringify({ project: "ENG", workspace: "acme" })
  );
  process.chdir(directory);

  try {
    const config = { token: "t", url: "http://flint.test" };

    expect(await workspaceOf(config, { project: "OPS" })).toBe("globex");
    expect(await workspaceOf(config, {})).toBe("acme");

    const [contradiction] = await Promise.allSettled([
      workspaceOf(config, { project: "OPS", workspace: "acme" }),
    ]);

    expect(contradiction).toMatchObject({
      reason: { message: "Project OPS is in workspace globex, not acme" },
      status: "rejected",
    });
  } finally {
    process.chdir(cwd);
    await rm(directory, { force: true, recursive: true });
  }
});

test("completion walks the command tree, its options and their choices", () => {
  const program = createProgram();

  expect(complete(program, ["iss"])).toContain("issue\tWork with issues");
  expect(complete(program, ["issue", "update", "--pr"])).toContain(
    "--priority\tpriority"
  );
  expect(complete(program, ["issue", "update", "--priority", ""])).toContain(
    "urgent"
  );
  expect(complete(program, ["issue", "attach", "ENG-1", ""])).toEqual([]);
  expect(complete(program, [""])).not.toContain("__complete");
});

const page = (pagePath: string, sortKey: string, kind = "page") => ({
  id: pagePath,
  kind: kind === "folder" ? ("folder" as const) : ("page" as const),
  path: pagePath,
  revision: 1,
  sortKey,
  title: pagePath.toUpperCase(),
  updatedAt: "",
});

test("the wiki tree nests children under parents in sibling order", () => {
  expect(
    treeRows([
      page("guides", "a0", "folder"),
      page("guides/setup", "a1"),
      page("guides/intro", "a0"),
      page("about", "a1"),
    ])
  ).toEqual([
    ["guides/", "GUIDES"],
    ["  intro", "GUIDES/INTRO"],
    ["  setup", "GUIDES/SETUP"],
    ["about", "ABOUT"],
  ]);
});

test("an update body with a field its endpoint does not know fails the compile", () => {
  const body: unknown = changes("PATCH /labels/:labelId", {
    // @ts-expect-error -- UpdateLabelSchema has `name`, not `title`.
    title: "Renamed",
  });

  expect(body).toEqual({ title: "Renamed" });
  expect(() => changes("PATCH /labels/:labelId", {})).toThrow(
    "Pass something to change"
  );
});

const attachment = (id: string) => ({
  contentType: "text/plain",
  filename: `${id}.txt`,
  id,
  url: `/files/${id}`,
});

const withFiles = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "flint-cli-"));

  try {
    await Bun.write(path.join(directory, "a.txt"), "a");
    await Bun.write(path.join(directory, "b.txt"), "b");
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

test("uploads check every path first and a failure lists the finished uploads", async () => {
  await withFiles(async (directory) => {
    let uploads = 0;

    stubApi({
      "POST /issues/ENG-1/attachments": () => {
        uploads += 1;

        return uploads === 1
          ? Response.json(attachment("one"), { status: 201 })
          : Response.json(
              { error: { code: "too_large", message: "Too large" } },
              { status: 413 }
            );
      },
    });

    const a = path.join(directory, "a.txt");
    const b = path.join(directory, "b.txt");
    const gone = path.join(directory, "gone.txt");

    expect(await flint("issue", "attach", "ENG-1", a, gone)).toBe(1);
    expect(requests).toEqual([]);
    expect(JSON.parse(printed.join(""))).toMatchObject({
      error: { message: `No such file ${gone}` },
    });

    expect(await flint("issue", "attach", "ENG-1", directory)).toBe(1);
    expect(JSON.parse(printed.join(""))).toMatchObject({
      error: { message: `Not a file: ${directory}` },
    });

    expect(await flint("issue", "attach", "ENG-1", a, b)).toBe(1);
    expect(JSON.parse(printed.join(""))).toEqual({
      attachments: [attachment("one")],
      error: { code: "too_large", message: "Too large" },
    });
  });
});

const moved = (revision: number) => ({
  id: "p1",
  path: "guides/moved",
  revision,
  workspaceSlug: "acme",
});

test("wiki attach --inline appends to the page by id, wherever it moved", async () => {
  await withFiles(async (directory) => {
    let reads = 0;
    let patches = 0;

    stubApi({
      "GET /wiki/p1": () => {
        reads += 1;

        return Response.json(moved(reads + 1));
      },
      "GET /workspaces/acme/wiki/guides/old": reply({ id: "p1" }),
      "PATCH /workspaces/acme/wiki/guides/moved": () => {
        patches += 1;

        return patches === 1
          ? Response.json(
              { error: { code: "conflict", message: "changed" } },
              { status: 409 }
            )
          : Response.json(moved(4));
      },
      "POST /wiki/p1/attachments": reply(attachment("one"), 201),
    });

    expect(
      await flint(
        "wiki",
        "attach",
        "-w",
        "acme",
        "guides/old",
        path.join(directory, "a.txt"),
        "--inline"
      )
    ).toBe(0);
    expect(requests.filter((line) => line.startsWith("PATCH"))).toEqual([
      'PATCH /workspaces/acme/wiki/guides/moved {"append":"\\n[one.txt](/files/one)\\n","baseRevision":2,"id":"p1"}',
      'PATCH /workspaces/acme/wiki/guides/moved {"append":"\\n[one.txt](/files/one)\\n","baseRevision":3,"id":"p1"}',
    ]);
    expect(JSON.parse(printed.join(""))).toMatchObject({
      attachments: [attachment("one")],
      page: { revision: 4 },
    });
  });
});

test("a network failure during uploads still lists the finished uploads", async () => {
  await withFiles(async (directory) => {
    let uploads = 0;

    stubApi({
      "GET /workspaces/acme/wiki/guides/old": reply({ id: "p1" }),
      "PATCH /workspaces/acme/wiki/guides/moved": () => {
        throw new TypeError("fetch failed");
      },
      "GET /wiki/p1": reply(moved(2)),
      "POST /issues/ENG-1/attachments": () => {
        uploads += 1;

        if (uploads > 1) {
          throw new TypeError("fetch failed");
        }

        return Response.json(attachment("one"), { status: 201 });
      },
      "POST /wiki/p1/attachments": reply(attachment("one"), 201),
    });

    const a = path.join(directory, "a.txt");
    const b = path.join(directory, "b.txt");

    expect(await flint("issue", "attach", "ENG-1", a, b)).toBe(1);
    expect(JSON.parse(printed.join(""))).toEqual({
      attachments: [attachment("one")],
      error: { code: "cli_error", message: "fetch failed" },
    });

    expect(
      await flint("wiki", "attach", "-w", "acme", "guides/old", a, "--inline")
    ).toBe(1);
    expect(JSON.parse(printed.join(""))).toEqual({
      attachments: [attachment("one")],
      error: { code: "cli_error", message: "fetch failed" },
    });
  });
});

test("a failed wiki append still reports the uploaded attachments", async () => {
  await withFiles(async (directory) => {
    stubApi({
      "GET /workspaces/acme/wiki/guides/old": reply({ id: "p1" }),
      "POST /wiki/p1/attachments": reply(attachment("one"), 201),
    });

    expect(
      await flint(
        "wiki",
        "attach",
        "-w",
        "acme",
        "guides/old",
        path.join(directory, "a.txt"),
        "--inline"
      )
    ).toBe(1);
    expect(JSON.parse(printed.join(""))).toMatchObject({
      attachments: [attachment("one")],
      error: { code: "not_found" },
    });
  });
});

test("removing a workspace logo needs --yes outside a terminal", async () => {
  stubApi({
    "DELETE /workspaces/acme/logo": () => new Response(null, { status: 204 }),
  });

  expect(await flint("workspace", "logo", "-w", "acme", "--remove")).toBe(2);
  expect(requests).toEqual([]);
  expect(
    await flint("workspace", "logo", "-w", "acme", "--remove", "--yes")
  ).toBe(0);
  expect(requests).toEqual(["DELETE /workspaces/acme/logo"]);
});

test("attachment download saves the file under its name and never overwrites it", async () => {
  await withFiles(async (directory) => {
    stubApi({
      "GET /files/f1": () =>
        new Response("hello", {
          headers: {
            "content-disposition": `attachment; filename="_.txt"; filename*=UTF-8''${encodeURIComponent("../Заметка.txt")}`,
          },
        }),
    });

    const cwd = process.cwd();

    process.chdir(directory);

    try {
      expect(await flint("attachment", "download", "f1")).toBe(0);
      expect(await Bun.file(path.join(directory, "Заметка.txt")).text()).toBe(
        "hello"
      );
      expect(await flint("attachment", "download", "f1")).toBe(1);
      expect(JSON.parse(printed.join(""))).toMatchObject({
        error: { message: "Заметка.txt exists; pass -o <path>" },
      });
      expect(await flint("attachment", "download", "f1", "-o", "a.txt")).toBe(
        0
      );
      expect(await Bun.file(path.join(directory, "a.txt")).text()).toBe(
        "hello"
      );
      expect(await flint("attachment", "download", "nope")).toBe(1);
      expect(JSON.parse(printed.join(""))).toEqual({
        error: { code: "not_found", message: "GET /files/nope" },
      });
    } finally {
      process.chdir(cwd);
    }
  });
});
