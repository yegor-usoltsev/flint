import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { createToken, revokeToken } from "~/server/tokens.server";

const url = process.env["FLINT_URL"] ?? env.APP_URL;
const binary = process.env["FLINT_BIN"] ?? "";

const command =
  binary === ""
    ? ["bun", path.join(import.meta.dir, "../../cli/flint.ts")]
    : binary
        .split(" ")
        .map((part, index) => (index === 0 ? part : path.resolve(part)));

const home = await mkdtemp(path.join(os.tmpdir(), "flint-smoke-"));
const run = Date.now().toString(36);

const writePng = async (target: string, side: number) => {
  const source = Bun.file(
    path.join(import.meta.dir, "../../test/fixtures/noise.png")
  );

  await Bun.write(
    target,
    await new Bun.Image(source)
      .resize(side, side, { fit: "fill" })
      .png()
      .bytes()
  );
};

const ifVersion = "--if-version";
const priority = "--priority";

const [alice] = await db<{ id: string }[]>`
  select id from users where username = 'alice'
`;

if (alice === undefined) {
  throw new Error("Run bun run demo first");
}

const actor = { userId: alice.id };
const token = await createToken(actor, { name: "cli-smoke" });

const flint = (args: string[], stdin?: string) => {
  const result = Bun.spawnSync([...command, ...args], {
    cwd: home,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("FLINT_")
        )
      ),
      FLINT_CONFIG: path.join(home, "config.json"),
    },
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
  });

  const stdout = result.stdout.toString();
  const json = v.safeParse(v.pipe(v.string(), v.parseJson()), stdout).output;

  return { code: result.exitCode, json, stdout };
};

const ok = <Schema extends v.GenericSchema>(
  schema: Schema,
  args: string[],
  stdin?: string
) => {
  const result = flint(args, stdin);

  assert.equal(result.code, 0, `flint ${args.join(" ")}: ${result.stdout}`);

  return v.parse(schema, result.json);
};

const ErrorSchema = v.object({
  error: v.looseObject({
    code: v.string(),
    current: v.optional(
      v.looseObject({
        revision: v.optional(v.number()),
        version: v.optional(v.number()),
      })
    ),
  }),
});

const failure = (args: string[], code = 1) => {
  const result = flint(args);

  assert.equal(result.code, code, `flint ${args.join(" ")}: ${result.stdout}`);

  return v.parse(v.looseObject(ErrorSchema.entries), result.json).error;
};

const IssueSchema = v.looseObject({
  assigneeId: v.nullable(v.string()),
  checklistDone: v.number(),
  checklistTotal: v.number(),
  deletedAt: v.nullable(v.string()),
  description: v.string(),
  id: v.string(),
  key: v.string(),
  labelIds: v.array(v.string()),
  links: v.array(v.unknown()),
  priority: v.number(),
  projectId: v.string(),
  statusId: v.string(),
  title: v.string(),
  version: v.number(),
});

const PageSchema = v.looseObject({
  body: v.string(),
  id: v.string(),
  kind: v.string(),
  path: v.string(),
  revision: v.number(),
});

const AnySchema = v.unknown();
const ListSchema = v.array(v.looseObject({ key: v.string() }));
const IdSchema = v.looseObject({ id: v.string() });

const ProjectSchema = v.looseObject({
  key: v.string(),
  statuses: v.array(v.looseObject({ id: v.string(), name: v.string() })),
});

const NamedSchema = v.array(
  v.looseObject({ id: v.string(), name: v.string() })
);

const EventSchema = v.object({
  entity: v.string(),
  id: v.string(),
  projectId: v.nullable(v.string()),
});

const readEvents = async (signal: AbortSignal) => {
  const response = await fetch(new URL("/api/v1/workspaces/acme/stream", url), {
    headers: { authorization: `Bearer ${token.token}` },
    signal,
  });

  assert.equal(response.status, 200);
  assert.ok(response.body);

  return response.body.pipeThrough(new TextDecoderStream()).getReader();
};

const lines = (args: string[]) => flint(args).stdout.split("\n");

const issueFlows = async () => {
  const { statuses } = ok(ProjectSchema, ["project", "view", "ENG"]);

  const statusId = (name: string) =>
    statuses.find((status) => status.name === name)?.id;

  const labels = ok(NamedSchema, ["label", "list"]);

  const labelId = (name: string) =>
    labels.find((label) => label.name === name)?.id;

  const abort = new AbortController();
  const events = await readEvents(abort.signal);

  const greeting = await events.read();

  assert.equal(greeting.value, "retry: 3000\n\n");

  const issue = ok(IssueSchema, [
    "issue",
    "create",
    "-t",
    `CLI smoke ${run}`,
    "-s",
    "In Progress",
    priority,
    "high",
    "-a",
    "@me",
    "-l",
    "bug",
    "-d",
    "- [ ] one\n- [x] two",
  ]);

  assert.deepEqual(
    [
      issue.priority,
      issue.assigneeId,
      issue.statusId,
      issue.checklistDone,
      issue.checklistTotal,
    ],
    [2, alice.id, statusId("In Progress"), 1, 2]
  );

  const event = await events.read();

  assert.deepEqual(
    v.parse(EventSchema, JSON.parse(event.value?.slice(6) ?? "null")),
    { entity: "issue", id: issue.id, projectId: issue.projectId }
  );
  abort.abort();

  const edited = ok(IssueSchema, [
    "issue",
    "edit",
    issue.key,
    priority,
    "urgent",
    "-s",
    "In Review",
    "-a",
    "none",
    "--add-label",
    "Docs",
    "--remove-label",
    "bug",
  ]);

  assert.deepEqual(
    [edited.priority, edited.statusId, edited.assigneeId, edited.labelIds],
    [1, statusId("In Review"), null, [labelId("Docs")]]
  );
  assert.equal(
    ok(IssueSchema, ["issue", "status", "todo", issue.key.toLowerCase()])
      .statusId,
    statusId("Todo")
  );

  const checked = ok(IssueSchema, ["issue", "check", issue.key, "one"]);

  assert.equal(checked.checklistDone, 2);
  assert.equal(
    ok(IssueSchema, ["issue", "check", issue.key, "2", "--uncheck"])
      .checklistDone,
    1
  );

  const rewritten = ok(
    IssueSchema,
    [
      "issue",
      "update",
      issue.key,
      "-F",
      "-",
      ifVersion,
      String(checked.version + 1),
    ],
    "Rewritten by an agent"
  );

  assert.equal(rewritten.description, "Rewritten by an agent");

  const conflict = failure([
    "issue",
    "update",
    issue.key,
    "-t",
    "Stale",
    ifVersion,
    "1",
  ]);

  assert.equal(conflict.code, "conflict");
  assert.equal(conflict.current?.version, rewritten.version);

  const second = ok(IssueSchema, ["issue", "create", "-t", `CLI bulk ${run}`]);

  const bulk = ok(v.array(IssueSchema), [
    "issue",
    "update",
    issue.key,
    second.key,
    priority,
    "low",
    "--add-label",
    "Docs",
  ]);

  assert.deepEqual(
    bulk.map((item) => [item.key, item.priority, item.labelIds]),
    [
      [issue.key, 4, [labelId("Docs")]],
      [second.key, 4, [labelId("Docs")]],
    ]
  );

  const partial = failure([
    "issue",
    "update",
    second.key,
    "ENG-999999",
    priority,
    "high",
  ]);

  assert.equal(partial.code, "bulk_failed");
  assert.equal(
    failure(["issue", "update", issue.key, second.key, "-t", "x"], 2).code,
    "usage"
  );

  const comment = ok(IdSchema, [
    "comment",
    "add",
    issue.key,
    "Root",
    "cause",
    "found",
  ]);

  ok(
    AnySchema,
    ["comment", "edit", comment.id, "-F", "-"],
    "Root cause: cache"
  );

  const view = ok(
    v.looseObject({ comments: v.array(v.looseObject({ body: v.string() })) }),
    ["issue", "view", issue.key, "--comments"]
  );

  assert.deepEqual(
    view.comments.map(({ body }) => body),
    ["Root cause: cache"]
  );
  assert.equal(failure(["comment", "delete", comment.id], 2).code, "usage");
  ok(AnySchema, ["comment", "delete", comment.id, "--yes"]);
  assert.deepEqual(
    ok(v.array(v.unknown()), ["comment", "list", issue.key]),
    []
  );

  const attachment = path.join(home, "notes.txt");

  await writeFile(attachment, `attached ${run}`);

  const attached = ok(
    v.object({
      attachments: v.array(v.looseObject({ id: v.string(), url: v.string() })),
      issue: IssueSchema,
    }),
    ["issue", "attach", issue.key, attachment, "--inline"]
  );

  const [file] = attached.attachments;

  assert.ok(
    file !== undefined &&
      attached.issue.description.endsWith(`[notes.txt](${file.url})`)
  );

  const downloaded = path.join(home, "downloaded.txt");

  ok(AnySchema, ["attachment", "download", file.id, "-o", downloaded]);
  assert.equal(await readFile(downloaded, "utf-8"), `attached ${run}`);
  assert.deepEqual(
    ok(v.array(IdSchema), ["attachment", "list", "--issue", issue.key]).map(
      ({ id }) => id
    ),
    [file.id]
  );
  ok(AnySchema, ["attachment", "delete", file.id, "--yes"]);
  assert.deepEqual(
    ok(v.array(v.unknown()), ["attachment", "list", "--issue", issue.key]),
    []
  );

  assert.ok(
    ok(ListSchema, [
      "issue",
      "list",
      "-q",
      `CLI smoke ${run}`,
      "-s",
      "Todo",
    ]).some(({ key }) => key === issue.key)
  );
  assert.ok(
    ok(ListSchema, ["issue", "list", "-w", "acme", priority, "high"]).some(
      ({ key }) => key === second.key
    )
  );
  assert.ok(
    ok(
      v.object({
        issues: ListSchema,
        pages: v.array(v.unknown()),
        semantic: v.boolean(),
      }),
      ["search", issue.key]
    ).issues[0]?.key === issue.key
  );
  assert.equal(
    flint(["issue", "branch", issue.key]).stdout.trim(),
    `alice/${issue.key}-cli-smoke-${run}`
  );
  assert.ok(
    ok(v.array(v.looseObject({ kind: v.string() })), [
      "issue",
      "activity",
      issue.key,
    ]).length > 5
  );
  assert.equal(
    ok(IssueSchema, [
      "api",
      "PATCH",
      `/issues/${issue.key}`,
      "-F",
      "priority=3",
    ]).priority,
    3
  );

  const deleted = ok(v.array(IssueSchema), [
    "issue",
    "delete",
    issue.key,
    second.key,
    "--yes",
  ]);

  assert.ok(deleted.every((item) => item.deletedAt !== null));
  assert.equal(
    failure(["issue", "delete", second.key, "--yes"], 1).code,
    "deleted"
  );
  assert.equal(
    ok(IssueSchema, ["issue", "restore", issue.key]).deletedAt,
    null
  );
  ok(IssueSchema, ["issue", "delete", issue.key, "--yes"]);

  return [issue.key, second.key];
};

const TrashSchema = v.looseObject({
  issues: v.array(v.looseObject({ key: v.string() })),
  pages: v.array(v.looseObject({ id: v.string() })),
});

const wikiFlows = async () => {
  const page = `cli-smoke-${run}/notes`;

  const created = ok(
    PageSchema,
    ["wiki", "put", page, "-F", "-", "-t", "Smoke page"],
    "# Draft"
  );

  assert.equal(flint(["wiki", "get", page, "--raw"]).stdout, "# Draft\n");
  assert.equal(
    ok(PageSchema, ["wiki", "get", `cli-smoke-${run}`]).kind,
    "folder"
  );

  const appended = ok(PageSchema, ["wiki", "append", page, "-", "line"]);

  assert.equal(appended.body, "# Draft\n- line");

  const stale = failure([
    "wiki",
    "put",
    page,
    "-d",
    "stale",
    "--id",
    created.id,
    "--base-revision",
    String(created.revision),
  ]);

  assert.equal(stale.code, "conflict");
  assert.equal(stale.current?.revision, appended.revision);

  ok(PageSchema, [
    "wiki",
    "put",
    page,
    "-d",
    "fresh",
    "--id",
    created.id,
    "--base-revision",
    String(appended.revision),
  ]);

  const [latest] = ok(
    v.array(v.looseObject({ revision: v.number(), viaApi: v.boolean() })),
    ["wiki", "history", page]
  );

  assert.equal(latest?.viaApi, true);

  const restored = ok(PageSchema, [
    "wiki",
    "restore",
    page,
    String(latest.revision),
  ]);

  assert.deepEqual(
    [restored.body, restored.revision],
    ["fresh", latest.revision]
  );

  const picture = path.join(home, "dot.png");

  await writePng(picture, 2);

  const pictured = ok(
    v.object({
      attachments: v.array(v.looseObject({ url: v.string() })),
      page: PageSchema,
    }),
    ["wiki", "attach", page, picture, "--inline"]
  );

  assert.ok(
    pictured.page.body.endsWith(`![dot.png](${pictured.attachments[0]?.url})\n`)
  );
  assert.equal(
    ok(v.array(v.unknown()), ["attachment", "list", "--page", page]).length,
    1
  );

  ok(PageSchema, [
    "wiki",
    "folder",
    `cli-smoke-${run}/archive`,
    "-t",
    "Archive",
  ]);

  const moved = ok(PageSchema, [
    "wiki",
    "move",
    page,
    `cli-smoke-${run}/archive/notes`,
  ]);

  assert.deepEqual(
    [moved.id, moved.path],
    [created.id, `cli-smoke-${run}/archive/notes`]
  );
  assert.deepEqual(
    ok(v.array(v.looseObject({ path: v.string() })), [
      "wiki",
      "tree",
      "--prefix",
      `cli-smoke-${run}`,
    ]).map((item) => item.path),
    [
      `cli-smoke-${run}`,
      `cli-smoke-${run}/archive`,
      `cli-smoke-${run}/archive/notes`,
    ]
  );
  assert.match(
    flint(["wiki", "tree", "--prefix", `cli-smoke-${run}`, "--human"]).stdout,
    /^ {4}notes +Smoke page$/mu
  );
  assert.equal(failure(["wiki", "get", page]).code, "not_found");
  assert.equal(
    failure(["wiki", "delete", `cli-smoke-${run}`], 2).code,
    "usage"
  );

  const trashed = ok(v.looseObject({ id: v.string() }), [
    "wiki",
    "delete",
    `cli-smoke-${run}`,
    "--yes",
  ]);

  assert.equal(failure(["wiki", "get", moved.path]).code, "not_found");
  assert.ok(
    ok(TrashSchema, ["trash", "list"]).pages.some(({ id }) => id === trashed.id)
  );
  ok(AnySchema, ["trash", "restore", trashed.id]);
  ok(AnySchema, ["wiki", "get", moved.path]);
  ok(AnySchema, ["wiki", "delete", `cli-smoke-${run}`, "--yes"]);
  assert.equal(failure(["trash", "delete", trashed.id], 2).code, "usage");
  ok(AnySchema, ["trash", "delete", trashed.id, "--yes"]);
  assert.equal(failure(["trash", "restore", trashed.id]).code, "not_found");

  return `cli-smoke-${run}`;
};

const workspaceFlows = async () => {
  const slug = `smoke-${run}`;

  const key = `S${run
    .slice(-3)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "X")}`;

  ok(v.looseObject({ role: v.literal("admin") }), [
    "workspace",
    "create",
    slug,
    "--name",
    "Smoke",
    "--demo",
  ]);

  try {
    assert.ok(
      ok(v.array(v.looseObject({ slug: v.string() })), [
        "workspace",
        "list",
      ]).some((item) => item.slug === slug)
    );
    assert.equal(
      ok(v.looseObject({ name: v.string() }), [
        "workspace",
        "update",
        "-w",
        slug,
        "--name",
        "Smoke renamed",
        "--color",
        "teal",
      ]).name,
      "Smoke renamed"
    );

    const logo = path.join(home, "logo.png");

    await writePng(logo, 8);
    assert.match(
      ok(v.looseObject({ logoUrl: v.string() }), [
        "workspace",
        "logo",
        logo,
        "-w",
        slug,
      ]).logoUrl,
      /^\/files\//u
    );
    assert.equal(
      ok(v.looseObject({ logoUrl: v.nullable(v.string()) }), [
        "workspace",
        "logo",
        "--remove",
        "--yes",
        "-w",
        slug,
      ]).logoUrl,
      null
    );

    ok(ProjectSchema, [
      "project",
      "create",
      key,
      "--name",
      "Smoke",
      "-w",
      slug,
      "--icon",
      "rocket",
    ]);
    assert.equal(
      ok(v.looseObject({ name: v.string() }), [
        "project",
        "update",
        key,
        "--name",
        "Smoked",
      ]).name,
      "Smoked"
    );
    assert.deepEqual(
      ok(v.array(v.looseObject({ name: v.string() })), [
        "project",
        "list",
        "-w",
        slug,
      ])
        .map((item) => item.name)
        .toSorted(),
      ["Getting started", "Smoked"]
    );
    ok(AnySchema, ["project", "delete", key, "--yes"]);

    const label = ok(IdSchema, [
      "label",
      "create",
      "Smoke",
      "-w",
      slug,
      "-c",
      "red",
    ]);

    assert.equal(
      ok(v.looseObject({ color: v.string() }), [
        "label",
        "update",
        "smoke",
        "-w",
        slug,
        "-c",
        "blue",
      ]).color,
      "blue"
    );
    ok(AnySchema, ["label", "delete", label.id, "-w", slug, "--yes"]);

    ok(v.looseObject({ username: v.literal("bob") }), [
      "member",
      "add",
      "@bob",
      "-w",
      slug,
    ]);
    assert.equal(
      ok(v.looseObject({ role: v.string() }), [
        "member",
        "update",
        "bob",
        "--role",
        "admin",
        "-w",
        slug,
      ]).role,
      "admin"
    );
    ok(AnySchema, ["member", "remove", "bob", "-w", slug, "--yes"]);
    assert.deepEqual(
      ok(v.array(v.looseObject({ username: v.string() })), [
        "member",
        "list",
        "-w",
        slug,
      ]).map((item) => item.username),
      ["alice"]
    );

    const restricted = ok(
      v.looseObject({
        id: v.string(),
        token: v.string(),
        workspaces: v.array(v.looseObject({ slug: v.string() })),
      }),
      ["token", "create", `smoke-${run}`, "-w", slug, "-w", "acme"]
    );

    assert.deepEqual(
      restricted.workspaces.map((item) => item.slug).toSorted(),
      ["acme", slug].toSorted()
    );

    assert.ok(
      ok(v.array(IdSchema), ["token", "list"]).some(
        (item) => item.id === restricted.id
      )
    );
    ok(AnySchema, ["token", "revoke", restricted.id, "--yes"]);
  } finally {
    ok(AnySchema, ["workspace", "delete", slug, "--yes"]);
  }

  assert.equal(failure(["workspace", "view", "-w", slug]).code, "not_found");
};

const cliFlows = () => {
  assert.equal(failure(["issue", "frobnicate"], 2).code, "usage");
  assert.equal(failure(["issue"], 2).code, "usage");
  assert.equal(
    failure(["issue", "create", "-t", "x", ifVersion, "1"], 2).code,
    "usage"
  );
  assert.equal(failure(["issue", "update", "ENG-1"], 2).code, "usage");
  assert.equal(failure(["whoami", "extra"], 2).code, "usage");
  assert.equal(failure(["wiki", "delete", "a", "b", "--yes"], 2).code, "usage");
  assert.equal(
    failure(["issue", "update", "ENG-1", priority, "huge"], 2).code,
    "usage"
  );
  assert.equal(failure(["link", "-w", "acme", "-p", "NOPE"]).code, "not_found");
  assert.equal(failure(["api", "GET", "/issues/ENG-999999"]).code, "not_found");
  assert.ok(flint(["skill"]).stdout.startsWith("# Flint CLI guide"));
  assert.match(flint(["--help"]).stdout, /Exit codes/u);
  assert.match(flint(["whoami", "--human"]).stdout, /^@alice /u);

  for (const shell of ["bash", "zsh", "fish"]) {
    assert.match(flint(["completion", shell]).stdout, /__complete/u);
  }

  assert.ok(
    lines(["__complete", "--", "issue", "up"]).includes(
      "update\tChange one issue, or the same properties of several (bulk)"
    )
  );
  assert.ok(
    lines(["__complete", "--", "issue", "update", "--pr"]).some((line) =>
      line.startsWith("--priority\t")
    )
  );
  assert.ok(
    lines(["__complete", "--", "issue", "update", priority, ""]).includes(
      "urgent"
    )
  );
};

try {
  ok(v.looseObject({ username: v.literal("alice") }), [
    "login",
    "--url",
    url,
    "--token",
    token.token,
  ]);
  ok(AnySchema, ["link", "-w", "acme", "-p", "eng"]);
  assert.ok(ok(v.array(v.unknown()), ["member", "list"]).length > 0);

  const keys = await issueFlows();
  const wiki = await wikiFlows();

  await workspaceFlows();
  cliFlows();

  for (const key of keys) {
    ok(AnySchema, ["trash", "delete", key, "--yes"]);
  }

  console.info(
    `CLI smoke passed against ${url} with ${command.join(" ")} (${keys.join(", ")} and wiki ${wiki}, all purged)`
  );
} finally {
  await revokeToken(actor, token.id);
  await rm(home, { force: true, recursive: true });
  await db.close();
}
