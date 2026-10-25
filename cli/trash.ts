import type { Command } from "commander";

import type { TrashedPage } from "../src/lib/api-types.ts";
import {
  action,
  call,
  confirm,
  localTime,
  readConfig,
  table,
  usageError,
  workspaceOf,
  yesFlags,
} from "./client.ts";
import type { Output, Scope } from "./client.ts";

const itemArgument =
  "issue key such as ENG-12, or a wiki page id from trash list";

const issueKey = /^[a-z][a-z0-9]*-\d+$/iu;
const pageId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

const kindOf = (item: string) => {
  if (issueKey.test(item)) {
    return "issue";
  }

  if (pageId.test(item)) {
    return "page";
  }

  throw usageError(`${item} is neither an issue key nor a wiki page id`);
};

const by = (user: { username: string } | null) =>
  user === null ? "" : `@${user.username}`;

const pageLabel = (page: TrashedPage) => {
  const suffix = page.kind === "folder" ? "/" : "";
  const inside = page.descendants > 0 ? ` (+${String(page.descendants)})` : "";

  return page.path + suffix + inside;
};

const listTrash = async (options: Scope): Promise<Output> => {
  const config = await readConfig();
  const slug = await workspaceOf(config, options);

  const trash = await call(config, "GET /workspaces/:slug/trash", {
    params: { slug },
  });

  return {
    result: trash,
    text: () =>
      table([
        ["ITEM", "TITLE", "DELETED", "BY", "PURGED"],
        ...trash.issues.map((issue) => [
          issue.key,
          issue.title,
          localTime(issue.deletedAt),
          by(issue.deletedBy),
          localTime(issue.purgeAt),
        ]),
        ...trash.pages.map((page) => [
          page.id,
          `${page.title} · ${pageLabel(page)}`,
          localTime(page.deletedAt),
          by(page.deletedBy),
          localTime(page.purgeAt),
        ]),
      ]),
  };
};

const restoreItem = async (item: string): Promise<Output> => {
  const config = await readConfig();

  if (kindOf(item) === "issue") {
    const issue = await call(config, "POST /issues/:issueKey/restore", {
      params: { issueKey: item },
    });

    return { result: issue, text: () => `Restored ${issue.key}` };
  }

  const page = await call(config, "POST /wiki/:pageId/restore", {
    params: { pageId: item },
  });

  return { result: page, text: () => `Restored ${page.path}` };
};

const deleteItem = async (
  item: string,
  options: { yes?: boolean }
): Promise<Output> => {
  const kind = kindOf(item);

  await confirm(`Delete ${item} forever? This cannot be undone.`, options.yes);

  const config = await readConfig();

  await (kind === "issue"
    ? call(config, "DELETE /trash/issues/:issueKey", {
        params: { issueKey: item },
      })
    : call(config, "DELETE /trash/wiki/:pageId", { params: { pageId: item } }));

  return { result: { deleted: item }, text: () => `Deleted ${item} forever` };
};

export const registerTrash = (program: Command) => {
  const trash = program
    .command("trash")
    .description(
      "Deleted issues and wiki pages, kept for the instance's retention period (default 30 days)"
    );

  trash
    .command("list")
    .description("List the trash of a workspace")
    .option("-w, --workspace <slug>", "workspace (default: flint link)")
    .option("-p, --project <key>", "use the workspace of this project")
    .action(action(listTrash));

  trash
    .command("restore")
    .description("Restore an issue or a wiki page with the pages under it")
    .argument("<item>", itemArgument)
    .action(action(restoreItem));

  trash
    .command("delete")
    .description("Delete an item in the trash forever (workspace admins)")
    .argument("<item>", itemArgument)
    .option(...yesFlags)
    .action(action(deleteItem));
};
