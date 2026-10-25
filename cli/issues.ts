import { Option } from "commander";
import type { Command } from "commander";

import type {
  Comment,
  GitLink,
  Issue,
  IssueEvent,
  IssueSummary,
  Label,
  Member,
  ProjectDetail,
} from "../src/lib/api-types.ts";
import { branchName } from "../src/lib/branch.ts";
import { setChecklistItem } from "../src/lib/checklist.ts";
import type { Body } from "../src/lib/endpoints.ts";
import { priorities } from "../src/lib/priorities.ts";
import type { Priority } from "../src/lib/priorities.ts";
import {
  action,
  call,
  CliError,
  collect,
  confirm,
  integer,
  localTime,
  mapLimit,
  projectOf,
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

const keyArgument = ["<key>", "issue key, such as ENG-12"] as const;
const labelFlag = "-l, --label <name>";
const keysArgument = ["<keys...>", "issue keys"] as const;

const priorityNames = ["none", "urgent", "high", "medium", "low"];

const isPriority = (value: number): value is Priority =>
  Number.isInteger(value) && value >= 0 && value <= 4;

const parsePriority = (value: string): Priority => {
  const index = priorityNames.indexOf(value.toLowerCase());
  const priority = index === -1 ? Number(value) : index;

  if (!isPriority(priority)) {
    throw usageError(
      `Unknown priority ${value}: use ${priorityNames.join(", ")} or 0-4`
    );
  }

  return priority;
};

const cached = async <Value>(
  cache: Map<string, Promise<Value>>,
  key: string,
  load: () => Promise<Value>
) => {
  const loading = cache.get(key) ?? load();

  cache.set(key, loading);

  return await loading;
};

const getIssue = async (config: Config, key: string) =>
  await call(config, "GET /issues/:issueKey", { params: { issueKey: key } });

const patchIssue = async (
  config: Config,
  key: string,
  body: Body<"PATCH /issues/:issueKey">
) =>
  await call(config, "PATCH /issues/:issueKey", {
    body,
    params: { issueKey: key },
  });

const projectKeyOf = (issueKey: string) =>
  issueKey.split("-")[0]?.toUpperCase() ?? "";

const looksLikeKey = (text: string) =>
  /^[A-Za-z][A-Za-z0-9]{1,4}-\d+$/u.test(text);

const requireTitle = (title: string | undefined) => {
  if (title?.trim() === "") {
    throw usageError("The title must not be empty");
  }
};

const lookups = (config: Config) => {
  const projects = new Map<string, Promise<ProjectDetail>>();
  const labels = new Map<string, Promise<Label[]>>();
  const members = new Map<string, Promise<Member[]>>();

  return {
    config,
    labels: async (slug: string) =>
      await cached(
        labels,
        slug,
        async () =>
          await call(config, "GET /workspaces/:slug/labels", {
            params: { slug },
          })
      ),
    members: async (slug: string) =>
      await cached(
        members,
        slug,
        async () =>
          await call(config, "GET /workspaces/:slug/members", {
            params: { slug },
          })
      ),
    project: async (key: string) =>
      await cached(
        projects,
        key.toUpperCase(),
        async () =>
          await call(config, "GET /projects/:key", { params: { key } })
      ),
  };
};

type Lookups = ReturnType<typeof lookups>;

const findNamed = <Item extends { id: string; name: string }>(
  items: Item[],
  name: string,
  what: string
) => {
  const item = items.find(
    (candidate) =>
      candidate.id === name ||
      candidate.name.toLowerCase() === name.toLowerCase()
  );

  if (item === undefined) {
    const known = items.map((candidate) => candidate.name).join(", ");

    const message = `Unknown ${what} “${name}”; ${
      known === "" ? `this workspace has no ${what}s` : `use one of: ${known}`
    }`;

    throw usageError(message);
  }

  return item;
};

const resolveAssignee = async (
  lookup: Lookups,
  slug: string,
  assignee: string
) => {
  if (assignee === "none") {
    return null;
  }

  if (assignee === "@me" || assignee === "me") {
    const me = await call(lookup.config, "GET /me");

    return me.id;
  }

  const username = assignee.replace(/^@/u, "").toLowerCase();

  const members = await lookup.members(slug);

  const member = members.find(
    (candidate) => candidate.username.toLowerCase() === username
  );

  if (member?.userId === undefined || member.userId === null) {
    throw new CliError(`@${username} is not a workspace member`, 1, {
      error: {
        code: "not_found",
        message: `@${username} is not a workspace member`,
      },
    });
  }

  return member.userId;
};

const resolveLabels = async (
  lookup: Lookups,
  slug: string,
  names: string[] = []
) => {
  if (names.length === 0) {
    return [];
  }

  const labels = await lookup.labels(slug);

  return names.map((name) => findNamed(labels, name, "label").id);
};

interface PropertyOptions {
  assignee?: string;
  description?: string;
  file?: string;
  label?: string[];
  priority?: string;
  status?: string;
  title?: string;
}

const addProperties = (command: Command) =>
  command
    .option("-t, --title <title>", "title")
    .option("-d, --description <text>", "description (Markdown)")
    .option(
      "-F, --file <file>",
      "read the description from a file, - for stdin"
    )
    .option("-s, --status <name>", "status by name")
    .addOption(
      new Option("--priority <priority>", "priority").choices([
        ...priorityNames,
        "0",
        "1",
        "2",
        "3",
        "4",
      ])
    )
    .option("-a, --assignee <user>", "@me, a username or none");

type Update = Body<"PATCH /issues/:issueKey">;

type Create = Body<"POST /projects/:key/issues">;

type Shared = Exclude<keyof Update & keyof Create, "title">;

const properties = async (
  lookup: Lookups,
  project: ProjectDetail,
  options: PropertyOptions,
  description: string | undefined
): Promise<Pick<Update, Shared> & Pick<Create, Shared>> => ({
  assigneeId:
    options.assignee === undefined
      ? undefined
      : await resolveAssignee(lookup, project.workspaceSlug, options.assignee),
  description,
  priority:
    options.priority === undefined
      ? undefined
      : parsePriority(options.priority),
  statusId:
    options.status === undefined
      ? undefined
      : findNamed(project.statuses, options.status, "status").id,
});

const statusName = (project: ProjectDetail, id: string) =>
  project.statuses.find((status) => status.id === id)?.name ?? "";

const linkLine = (link: GitLink) => {
  const id =
    link.kind === "commit" ? link.externalId.slice(0, 7) : link.externalId;

  const state = [link.state, link.ciState && `CI ${link.ciState}`]
    .filter(Boolean)
    .join(", ");

  const suffix = state === "" ? "" : ` [${state}]`;

  return `  ${link.kind.replace("_", " ")} ${id}${suffix} ${link.title} ${link.url}`;
};

const describeIssue = async (lookup: Lookups, issue: Issue) => {
  const project = await lookup.project(projectKeyOf(issue.key));

  const [members, labels] = await Promise.all([
    lookup.members(project.workspaceSlug),
    lookup.labels(project.workspaceSlug),
  ]);

  const assignee = members.find((member) => member.userId === issue.assigneeId);

  const labelIds = new Set(issue.labelIds);

  const labelNames = labels.flatMap((label) =>
    labelIds.has(label.id) ? [label.name] : []
  );

  return [
    `${issue.key}  ${issue.title}${issue.deletedAt === null ? "" : "  (deleted)"}`,
    [
      statusName(project, issue.statusId),
      priorities[issue.priority],
      assignee === undefined ? "unassigned" : `@${assignee.username}`,
      ...labelNames,
      `v${issue.version}`,
    ].join(" · "),
    new URL(`/${project.workspaceSlug}/issue/${issue.key}`, lookup.config.url)
      .href,
    ...(issue.description === "" ? [] : ["", issue.description]),
    ...(issue.links.length === 0
      ? []
      : ["", "Development:", ...issue.links.map(linkLine)]),
  ].join("\n");
};

const issueOutput = (lookup: Lookups, issue: Issue): Output => ({
  result: issue,
  text: async () => await describeIssue(lookup, issue),
});

const issueRows = async (lookup: Lookups, issues: IssueSummary[]) => {
  const rows = await Promise.all(
    issues.map(async (issue) => {
      const project = await lookup.project(projectKeyOf(issue.key));
      const members = await lookup.members(project.workspaceSlug);

      const assignee = members.find(
        (member) => member.userId === issue.assigneeId
      );

      return [
        issue.key,
        statusName(project, issue.statusId),
        priorities[issue.priority],
        assignee === undefined ? "" : `@${assignee.username}`,
        issue.title,
      ];
    })
  );

  return table([["KEY", "STATUS", "PRIORITY", "ASSIGNEE", "TITLE"], ...rows]);
};

const forEachIssue = async (
  lookup: Lookups,
  keys: string[],
  run: (key: string) => Promise<Issue>
): Promise<Output> => {
  const [only] = keys;

  if (only !== undefined && keys.length === 1) {
    return issueOutput(lookup, await run(only));
  }

  const results = await mapLimit(keys, run);

  const issues = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );

  const failed = results.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return [];
    }

    const reason: unknown = result.reason;

    return [
      {
        key: keys[index] ?? "",
        message: reason instanceof Error ? reason.message : String(reason),
        response: reason instanceof CliError ? reason.body : null,
      },
    ];
  });

  if (failed.length > 0) {
    const message = `${failed.length} of ${keys.length} issues failed: ${failed.map(({ key }) => key).join(", ")}`;

    throw new CliError(message, 1, {
      error: { code: "bulk_failed", failed, message },
      issues: issues.map(({ key }) => key),
    });
  }

  return {
    result: issues,
    text: () =>
      issues.map((issue) => `${issue.key}  ${issue.title}`).join("\n"),
  };
};

interface UpdateOptions extends PropertyOptions {
  addLabel?: string[];
  ifVersion?: string;
  removeLabel?: string[];
}

const updateIssues = async (keys: string[], options: UpdateOptions) => {
  const bulk = keys.length > 1;

  if (
    bulk &&
    [options.title, options.description, options.file, options.ifVersion].some(
      (value) => value !== undefined
    )
  ) {
    throw usageError("-t, -d, -F and --if-version change one issue at a time");
  }

  requireTitle(options.title);

  if (
    options.label !== undefined &&
    (options.addLabel !== undefined || options.removeLabel !== undefined)
  ) {
    throw usageError(
      "-l replaces the labels; use it without --add-label and --remove-label"
    );
  }

  const description = await textOf(options);
  const labelsChange = [options.label, options.addLabel, options.removeLabel];

  if (
    [
      options.title,
      description,
      options.status,
      options.priority,
      options.assignee,
      ...labelsChange,
    ].every((value) => value === undefined)
  ) {
    throw usageError("Pass something to change, such as -s, --priority or -a");
  }

  const lookup = lookups(await readConfig());

  return await forEachIssue(lookup, keys, async (key) => {
    const project = await lookup.project(projectKeyOf(key));
    const slug = project.workspaceSlug;

    let labels: Pick<Update, "addLabelIds" | "labelIds" | "removeLabelIds"> =
      {};

    const version =
      options.ifVersion === undefined
        ? undefined
        : integer(options.ifVersion, "--if-version");

    if (labelsChange.some((names) => names !== undefined)) {
      const [replacing, adding, removing] = await Promise.all(
        labelsChange.map(
          async (names) => await resolveLabels(lookup, slug, names)
        )
      );

      labels =
        options.label === undefined
          ? { addLabelIds: adding, removeLabelIds: removing }
          : { labelIds: replacing };
    }

    return await patchIssue(lookup.config, key, {
      ...(await properties(lookup, project, options, description)),
      ...labels,
      title: options.title,
      version,
    });
  });
};

interface ListOptions extends Scope {
  assignee?: string[];
  closed?: boolean;
  label?: string[];
  limit?: string;
  offset?: string;
  priority?: string[];
  query?: string;
  status?: string[];
}

const listIssues = async (options: ListOptions): Promise<Output> => {
  const config = await readConfig();
  const lookup = lookups(config);
  const project = await projectOf(options);

  const query = {
    assignee: options.assignee?.map((value) => value.replace(/^@/u, "")),
    closed: options.closed,
    label: options.label,
    limit:
      options.limit === undefined
        ? undefined
        : integer(options.limit, "--limit"),
    offset:
      options.offset === undefined
        ? undefined
        : integer(options.offset, "--offset"),
    priority: options.priority,
    q: options.query,
    status: options.status,
  };

  if (options.project !== undefined && options.workspace !== undefined) {
    await workspaceOf(config, options);
  }

  const issues =
    project === undefined
      ? await call(config, "GET /workspaces/:slug/issues", {
          params: { slug: await workspaceOf(config, options) },
          query,
        })
      : await call(config, "GET /projects/:key/issues", {
          params: { key: project },
          query,
        });

  return { result: issues, text: async () => await issueRows(lookup, issues) };
};

interface CreateOptions extends PropertyOptions, Scope {
  title: string;
}

const createIssue = async (options: CreateOptions): Promise<Output> => {
  const key = await projectOf(options);

  if (key === undefined) {
    throw usageError("Pass -p <KEY>, run flint link or set FLINT_PROJECT");
  }

  const description = await textOf(options);
  const lookup = lookups(await readConfig());
  const project = await lookup.project(key);

  if (
    options.workspace !== undefined &&
    options.workspace !== project.workspaceSlug
  ) {
    throw usageError(
      `Project ${project.key} is in workspace ${project.workspaceSlug}, not ${options.workspace}`
    );
  }

  const issue = await call(lookup.config, "POST /projects/:key/issues", {
    body: {
      ...(await properties(lookup, project, options, description)),
      labelIds: await resolveLabels(
        lookup,
        project.workspaceSlug,
        options.label
      ),
      title: options.title,
    },
    params: { key },
  });

  return issueOutput(lookup, issue);
};

const commentText = (comments: Comment[]) =>
  comments
    .map(
      (comment) =>
        `@${comment.author.username}${comment.viaApi ? " via API" : ""}  ${localTime(comment.createdAt)}  (${comment.id})\n${comment.body}\n`
    )
    .join("\n");

const viewIssue = async (
  key: string,
  options: { comments?: boolean }
): Promise<Output> => {
  const lookup = lookups(await readConfig());
  const params = { issueKey: key };
  const issue = await getIssue(lookup.config, key);

  if (options.comments !== true) {
    return issueOutput(lookup, issue);
  }

  const comments = await call(lookup.config, "GET /issues/:issueKey/comments", {
    params,
  });

  return {
    result: { ...issue, comments },
    text: async () =>
      `${await describeIssue(lookup, issue)}\n\nComments:\n\n${commentText(comments)}`,
  };
};

const changes = new Set(["assignee", "priority", "status", "title"]);

const eventChange = async (
  lookup: Lookups,
  project: ProjectDetail,
  { fromValue, kind, toValue }: IssueEvent
) => {
  const name = async (value: IssueEvent["toValue"]) => {
    if (value === null) {
      return "none";
    }

    if (kind === "priority") {
      return priorities[Number(value)] ?? String(value);
    }

    const id = String(value);

    if (kind === "status") {
      return statusName(project, id) || id;
    }

    if (kind === "assignee") {
      const members = await lookup.members(project.workspaceSlug);

      return `@${members.find((member) => member.userId === id)?.username ?? id}`;
    }

    const labels = await lookup.labels(project.workspaceSlug);

    return labels.find((label) => label.id === id)?.name ?? id;
  };

  if (kind === "label_added" || kind === "label_removed") {
    return await name(toValue ?? fromValue);
  }

  return changes.has(kind)
    ? `${await name(fromValue)} → ${await name(toValue)}`
    : "";
};

const issueActivity = async (key: string): Promise<Output> => {
  const lookup = lookups(await readConfig());

  const events = await call(lookup.config, "GET /issues/:issueKey/activity", {
    params: { issueKey: key },
  });

  return {
    result: events,
    text: async () => {
      const project = await lookup.project(projectKeyOf(key));

      const rows = await Promise.all(
        events.map(async (event) => [
          localTime(event.createdAt),
          `@${event.actor?.username ?? "system"}${event.viaApi ? " via API" : ""}`,
          event.kind.replace("_", " "),
          await eventChange(lookup, project, event),
        ])
      );

      return table(rows);
    },
  };
};

const checkItem = async (
  key: string,
  item: string[],
  options: { uncheck?: boolean }
): Promise<Output> => {
  const lookup = lookups(await readConfig());
  const issue = await getIssue(lookup.config, key);

  const text = item.join(" ");

  const result = setChecklistItem(
    issue.description,
    text,
    options.uncheck !== true
  );

  if ("matches" in result) {
    const listed = result.matches
      .map(
        ({ done, number, text: label }) =>
          `${number} [${done ? "x" : " "}] ${label}`
      )
      .join("; ");

    throw usageError(
      result.matches.length === 0
        ? `No checklist item “${text}” in ${issue.key}`
        : `“${text}” matches ${result.matches.length} checklist items in ${issue.key}: ${listed}; pass the number`
    );
  }

  return issueOutput(
    lookup,
    await patchIssue(lookup.config, key, {
      description: result.markdown,
      version: issue.version,
    })
  );
};

export const markdownLinks = (
  attachments: { contentType: string; filename: string; url: string }[]
) =>
  attachments.map(
    ({ contentType, filename, url }) =>
      `${contentType.startsWith("image/") ? "!" : ""}[${filename.replaceAll(/[[\]]/gu, "")}](${url})`
  );

const attachFiles = async (
  key: string,
  files: string[],
  options: { inline?: boolean }
): Promise<Output> => {
  const lookup = lookups(await readConfig());
  const params = { issueKey: key };

  const attachments = await uploadAll(
    files,
    async (body) =>
      await call(lookup.config, "POST /issues/:issueKey/attachments", {
        body,
        params,
      })
  );

  const text = () =>
    attachments.map(({ filename, url }) => `${filename}  ${url}`).join("\n");

  if (options.inline !== true) {
    return { result: attachments, text };
  }

  try {
    const issue = await getIssue(lookup.config, key);

    const description = [issue.description, ...markdownLinks(attachments)]
      .filter((part) => part !== "")
      .join("\n\n");

    const updated = await patchIssue(lookup.config, key, {
      description,
      version: issue.version,
    });

    return { result: { attachments, issue: updated }, text };
  } catch (error) {
    throw error instanceof CliError
      ? withAttachments(error, attachments)
      : error;
  }
};

const deleteIssues = async (keys: string[], options: { yes?: boolean }) => {
  await confirm(`Delete ${keys.join(", ")}?`, options.yes);

  const lookup = lookups(await readConfig());

  return await forEachIssue(
    lookup,
    keys,
    async (key) =>
      await call(lookup.config, "DELETE /issues/:issueKey", {
        params: { issueKey: key },
      })
  );
};

const restoreIssues = async (keys: string[]) => {
  const lookup = lookups(await readConfig());

  return await forEachIssue(
    lookup,
    keys,
    async (key) =>
      await call(lookup.config, "POST /issues/:issueKey/restore", {
        params: { issueKey: key },
      })
  );
};

const textOptions = (command: Command) =>
  command
    .option("-d, --description <text>", "the text")
    .option("-F, --file <file>", "read the text from a file, - for stdin");

const requireText = async (
  options: { description?: string; file?: string },
  words: string[]
) => {
  const body = await textOf(options, words);

  if (body === undefined) {
    throw usageError("Pass the text as arguments, -d <text> or -F <file|->");
  }

  return body;
};

export const registerIssues = (program: Command) => {
  const issue = program.command("issue").description("Work with issues");

  issue
    .command("list")
    .description(
      "List issues: the working set (open plus closed in the last 14 days), or --closed"
    )
    .option("-p, --project <key>", "project key")
    .option(
      "-w, --workspace <slug>",
      "workspace, for issues across its projects"
    )
    .option(
      "-s, --status <name>",
      "status name (repeat for any of several)",
      collect
    )
    .option(
      "-a, --assignee <user>",
      "@me, none, a username or id (repeatable)",
      collect
    )
    .option(labelFlag, "label name or id (repeatable)", collect)
    .option(
      "--priority <priority>",
      "none|urgent|high|medium|low or 0-4 (repeatable)",
      collect
    )
    .option(
      "-q, --query <text>",
      "title text, an exact key or full-text search"
    )
    .option("--closed", "list completed and canceled issues, newest first")
    .option("--limit <n>", "page size with --closed (default 50, max 200)")
    .option("--offset <n>", "page offset with --closed")
    .action(action(listIssues));

  issue
    .command("view")
    .description("Show an issue with its properties and Git links")
    .argument("<key>", "issue key, such as ENG-12")
    .option("--comments", "include the comments")
    .action(action(viewIssue));

  addProperties(
    issue
      .command("create")
      .description("Create an issue")
      .option("-p, --project <key>", "project key (default: flint link)")
      .option(
        "-w, --workspace <slug>",
        "check that the project is in this workspace"
      )
  )
    .option(labelFlag, "label name (repeatable)", collect)
    .action(
      action(async (options: CreateOptions) => {
        if (options.title === undefined) {
          throw usageError("issue create needs -t <title>");
        }

        requireTitle(options.title);

        return await createIssue(options);
      })
    );

  addProperties(
    issue
      .command("update")
      .alias("edit")
      .description("Change one issue, or the same properties of several (bulk)")
      .argument(...keysArgument)
  )
    .option(labelFlag, "replace the labels (repeatable)", collect)
    .option("--add-label <name>", "add a label (repeatable)", collect)
    .option("--remove-label <name>", "remove a label (repeatable)", collect)
    .option(
      "--if-version <n>",
      "fail with conflict unless the issue is still at this version"
    )
    .action(action(updateIssues));

  issue
    .command("status")
    .description("Set the status of one or more issues")
    .argument("<status>", "status name, quoted when it has spaces")
    .argument(...keysArgument)
    .action(
      action(async (status: string, keys: string[]) => {
        if (looksLikeKey(status) && !keys.every(looksLikeKey)) {
          throw usageError(
            `Unknown status “${status}”; the status comes first: flint issue status <status> <keys...>`
          );
        }

        return await updateIssues(keys, { status });
      })
    );

  issue
    .command("check")
    .description("Tick a checklist item by number or text")
    .argument(...keyArgument)
    .argument("<item...>", "item number (1-based) or text it contains")
    .option("--uncheck", "clear the box instead")
    .action(action(checkItem));

  issue
    .command("activity")
    .description("Show the history of an issue")
    .argument(...keyArgument)
    .action(action(issueActivity));

  issue
    .command("attach")
    .description("Upload files to an issue")
    .argument(...keyArgument)
    .argument("<files...>", "files to upload")
    .option("--inline", "also append Markdown links to the description")
    .action(action(attachFiles));

  issue
    .command("branch")
    .description("Print a Git branch name that links to the issue")
    .argument(...keyArgument)
    .action(
      action(async (key: string) => {
        const config = await readConfig();

        const [found, me] = await Promise.all([
          getIssue(config, key),
          call(config, "GET /me"),
        ]);

        const branch = branchName(me.username, found.key, found.title);

        return { raw: branch, result: branch };
      })
    );

  issue
    .command("delete")
    .description("Delete issues (restorable with issue restore)")
    .argument(...keysArgument)
    .option(...yesFlags)
    .action(action(deleteIssues));

  issue
    .command("restore")
    .description("Restore deleted issues")
    .argument(...keysArgument)
    .action(action(restoreIssues));

  const comment = program
    .command("comment")
    .description("Work with issue comments");

  comment
    .command("list")
    .description("List the comments of an issue")
    .argument(...keyArgument)
    .action(
      action(async (key: string) => {
        const comments = await call(
          await readConfig(),
          "GET /issues/:issueKey/comments",
          {
            params: { issueKey: key },
          }
        );

        return { result: comments, text: () => commentText(comments) };
      })
    );

  textOptions(
    comment
      .command("add")
      .description("Comment on an issue")
      .argument(...keyArgument)
      .argument("[text...]", "comment text (Markdown)")
  ).action(
    action(async (key: string, words: string[], options: PropertyOptions) => {
      const created = await call(
        await readConfig(),
        "POST /issues/:issueKey/comments",
        {
          body: { body: await requireText(options, words) },
          params: { issueKey: key },
        }
      );

      return {
        result: created,
        text: () => `Commented on ${key} (${created.id})`,
      };
    })
  );

  textOptions(
    comment
      .command("edit")
      .description("Replace the text of your comment")
      .argument("<id>", "comment id")
      .argument("[text...]", "new text (Markdown)")
  ).action(
    action(async (id: string, words: string[], options: PropertyOptions) => {
      const edited = await call(
        await readConfig(),
        "PATCH /comments/:commentId",
        {
          body: { body: await requireText(options, words) },
          params: { commentId: id },
        }
      );

      return { result: edited, text: () => `Edited comment ${id}` };
    })
  );

  comment
    .command("delete")
    .description("Delete your comment")
    .argument("<id>", "comment id")
    .option(...yesFlags)
    .action(
      action(async (id: string, options: { yes?: boolean }) => {
        await confirm(`Delete comment ${id}?`, options.yes);
        await call(await readConfig(), "DELETE /comments/:commentId", {
          params: { commentId: id },
        });

        return { result: { deleted: id }, text: () => `Deleted comment ${id}` };
      })
    );
};
