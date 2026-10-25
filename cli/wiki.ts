import type { Command } from "commander";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type {
  WikiPage,
  WikiPageSummary,
  WikiRevision,
} from "../src/lib/api-types.ts";
import {
  action,
  call,
  CliError,
  confirm,
  integer,
  localTime,
  readConfig,
  table,
  textOf,
  uploadAll,
  usageError,
  withAttachments,
  workspaceOf,
  yesFlags,
} from "./client.ts";
import type { Config, Output, Scope } from "./client.ts";
import { markdownLinks } from "./issues.ts";

const scoped = (command: Command) =>
  command
    .option("-w, --workspace <slug>", "workspace (default: flint link)")
    .option("-p, --project <key>", "use the workspace of this project");

const target = async (config: Config, scope: Scope, path: string) => ({
  _splat: path.split("/").filter(Boolean).join("/"),
  slug: await workspaceOf(config, scope),
});

const getPage = async (config: Config, scope: Scope, path: string) =>
  await call(config, "GET /workspaces/:slug/wiki/*", {
    params: await target(config, scope, path),
  });

const pageText = (page: WikiPage | WikiRevision) => () =>
  `${page.title} (${"path" in page ? page.path : "revision"} r${page.revision})\n\n${page.body}`;

const pageOutput = (page: WikiPage): Output => ({
  result: page,
  text: pageText(page),
});

export const treeRows = (pages: WikiPageSummary[]) => {
  const children = new Map<string, WikiPageSummary[]>();

  for (const page of pages) {
    const parent = page.path.includes("/")
      ? page.path.slice(0, page.path.lastIndexOf("/"))
      : "";

    children.set(parent, [...(children.get(parent) ?? []), page]);
  }

  const known = new Set(pages.map((page) => page.path));

  const walk = (parent: string, depth: number): string[][] =>
    (children.get(parent) ?? [])
      .toSorted((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      .flatMap((page) => [
        [
          `${"  ".repeat(depth)}${page.path.slice(page.path.lastIndexOf("/") + 1)}${page.kind === "folder" ? "/" : ""}`,
          page.title,
        ],
        ...walk(page.path, depth + 1),
      ]);

  const orphans = [...children.keys()].filter(
    (parent) => parent !== "" && !known.has(parent)
  );

  return [
    ...walk("", 0),
    ...orphans.flatMap((parent) => [[`${parent}/`, ""], ...walk(parent, 1)]),
  ];
};

const listPages = async (
  options: Scope & { prefix?: string }
): Promise<Output> => {
  const config = await readConfig();

  const pages = await call(config, "GET /workspaces/:slug/wiki", {
    params: { slug: await workspaceOf(config, options) },
    query: { prefix: options.prefix },
  });

  return { result: pages, text: () => table(treeRows(pages)) };
};

const readPage = async (
  path: string,
  options: Scope & { raw?: boolean; revision?: string }
): Promise<Output> => {
  const config = await readConfig();
  const page = await getPage(config, options, path);

  const shown =
    options.revision === undefined
      ? page
      : await call(config, "GET /wiki/:pageId/revisions/:revision", {
          params: {
            pageId: page.id,
            revision: String(integer(options.revision, "--revision")),
          },
        });

  return {
    raw: options.raw === true ? shown.body : undefined,
    result: shown,
    text: pageText(shown),
  };
};

interface PutOptions extends Scope {
  baseRevision?: string;
  description?: string;
  file?: string;
  id?: string;
  title?: string;
}

const putPage = async (
  path: string,
  words: string[],
  options: PutOptions
): Promise<Output> => {
  const body = await textOf(options, words);

  if (body === undefined) {
    throw usageError(
      "wiki put needs the page text: -F <file|->, -d <text> or arguments"
    );
  }

  const config = await readConfig();

  const page = await call(config, "PUT /workspaces/:slug/wiki/*", {
    body: {
      baseRevision:
        options.baseRevision === undefined
          ? undefined
          : integer(options.baseRevision, "--base-revision"),
      body,
      id: options.id,
      title: options.title,
    },
    params: await target(config, options, path),
  });

  return pageOutput(page);
};

const appendPage = async (
  path: string,
  words: string[],
  options: Scope & { description?: string; file?: string }
): Promise<Output> => {
  const append = await textOf(options, words);

  if (append === undefined || append === "") {
    throw usageError(
      "wiki append needs text: arguments, -d <text> or -F <file|->"
    );
  }

  const config = await readConfig();

  return pageOutput(
    await call(config, "PATCH /workspaces/:slug/wiki/*", {
      body: { append },
      params: await target(config, options, path),
    })
  );
};

const makeFolder = async (
  path: string,
  options: Scope & { title?: string }
): Promise<Output> => {
  const config = await readConfig();

  return pageOutput(
    await call(config, "PUT /workspaces/:slug/wiki/*", {
      body: { kind: "folder", title: options.title },
      params: await target(config, options, path),
    })
  );
};

const movePage = async (
  path: string,
  to: string,
  options: Scope & { sortKey?: string }
): Promise<Output> => {
  const config = await readConfig();
  const page = await getPage(config, options, path);

  return pageOutput(
    await call(config, "POST /wiki/:pageId/move", {
      body: { path: to, sortKey: options.sortKey },
      params: { pageId: page.id },
    })
  );
};

const pageHistory = async (path: string, options: Scope): Promise<Output> => {
  const config = await readConfig();
  const page = await getPage(config, options, path);

  const revisions = await call(config, "GET /wiki/:pageId/revisions", {
    params: { pageId: page.id },
  });

  return {
    result: revisions,
    text: () =>
      table(
        revisions.map((revision) => [
          `r${revision.revision}`,
          localTime(revision.updatedAt),
          `@${revision.author.username}${revision.viaApi ? " via API" : ""}`,
          revision.title,
        ])
      ),
  };
};

const restorePage = async (
  path: string,
  revision: string,
  options: Scope
): Promise<Output> => {
  const number = integer(revision, "revision");
  const config = await readConfig();
  const page = await getPage(config, options, path);

  return pageOutput(
    await call(config, "POST /wiki/:pageId/revisions/:revision/restore", {
      params: { pageId: page.id, revision: String(number) },
    })
  );
};

const deletePage = async (
  path: string,
  options: Scope & { yes?: boolean }
): Promise<Output> => {
  await confirm(
    `Move wiki page ${path} and the pages under it to the trash?`,
    options.yes
  );

  const config = await readConfig();
  const page = await getPage(config, options, path);

  await call(config, "DELETE /wiki/:pageId", { params: { pageId: page.id } });

  return {
    result: { deleted: page.path, id: page.id },
    text: () =>
      `Moved ${page.path} to the trash (restore: flint trash restore ${page.id})`,
  };
};

const ConflictSchema = v.object({
  error: v.object({ code: v.literal("conflict") }),
});

const attachFiles = async (
  path: string,
  files: string[],
  options: Scope & { inline?: boolean }
): Promise<Output> => {
  const config = await readConfig();
  const page = await getPage(config, options, path);

  const attachments = await uploadAll(
    files,
    async (body) =>
      await call(config, "POST /wiki/:pageId/attachments", {
        body,
        params: { pageId: page.id },
      })
  );

  const text = () =>
    attachments.map(({ filename, url }) => `${filename}  ${url}`).join("\n");

  if (options.inline !== true) {
    return { result: attachments, text };
  }

  const append = `\n${markdownLinks(attachments).join("\n\n")}\n`;

  const appendTo = async (attempt: number): Promise<WikiPage> => {
    const current = await call(config, "GET /wiki/:pageId", {
      params: { pageId: page.id },
    });

    try {
      return await call(config, "PATCH /workspaces/:slug/wiki/*", {
        body: { append, baseRevision: current.revision, id: current.id },
        params: { _splat: current.path, slug: current.workspaceSlug },
      });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof CliError &&
        v.is(ConflictSchema, error.body)
      ) {
        return await appendTo(attempt + 1);
      }

      throw error;
    }
  };

  try {
    const updated = await appendTo(1);

    return { result: { attachments, page: updated }, text };
  } catch (error) {
    throw withAttachments(error, attachments);
  }
};

const pageArgument = "page path, such as guides/setup";

export const registerWiki = (program: Command) => {
  const wiki = program
    .command("wiki")
    .description(
      "Work with the workspace wiki: pages and folders addressed by path"
    );

  scoped(
    wiki
      .command("tree")
      .alias("list")
      .description("Show the page tree")
      .option("--prefix <path>", "only paths that start with this")
  ).action(action(listPages));

  scoped(
    wiki
      .command("get")
      .description("Read a page")
      .argument("<path>", pageArgument)
      .option("--revision <n>", "read an earlier revision")
      .option("--raw", "print only the Markdown body")
  ).action(action(readPage));

  scoped(
    wiki
      .command("put")
      .description(
        "Create or replace a page; missing parent folders are created"
      )
      .argument("<path>", pageArgument)
      .argument("[text...]", "page text (Markdown)")
      .option("-d, --description <text>", "page text")
      .option("-F, --file <file>", "read the text from a file, - for stdin")
      .option("-t, --title <title>", "title (default: from the path)")
      .option("--id <id>", "page id read before editing, with --base-revision")
      .option(
        "--base-revision <n>",
        "fail with conflict unless the page is still at this revision (0: create only)"
      )
  ).action(action(putPage));

  scoped(
    wiki
      .command("append")
      .description("Append text to a page, creating it when missing")
      .argument("<path>", pageArgument)
      .argument("[text...]", "text to append")
      .option("-d, --description <text>", "text to append")
      .option("-F, --file <file>", "read the text from a file, - for stdin")
  ).action(action(appendPage));

  scoped(
    wiki
      .command("folder")
      .description("Create a folder")
      .argument("<path>", "folder path")
      .option("-t, --title <title>", "title (default: from the path)")
  ).action(action(makeFolder));

  scoped(
    wiki
      .command("move")
      .alias("rename")
      .description("Move or rename a page with the pages under it")
      .argument("<path>", pageArgument)
      .argument("<to>", "new path")
      .option("--sort-key <key>", "position among its new siblings")
  ).action(action(movePage));

  scoped(
    wiki
      .command("history")
      .description("List the revisions of a page")
      .argument("<path>", pageArgument)
  ).action(action(pageHistory));

  scoped(
    wiki
      .command("restore")
      .description("Restore an earlier revision as a new one")
      .argument("<path>", pageArgument)
      .argument("<revision>", "revision number")
  ).action(action(restorePage));

  scoped(
    wiki
      .command("delete")
      .description("Move a page with the pages under it to the trash")
      .argument("<path>", pageArgument)
      .option(...yesFlags)
  ).action(action(deletePage));

  scoped(
    wiki
      .command("attach")
      .description("Upload files to a page")
      .argument("<path>", pageArgument)
      .argument("<files...>", "files to upload")
      .option("--inline", "also append Markdown links to the page")
  ).action(action(attachFiles));
};
