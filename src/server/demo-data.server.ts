import type { TransactionSQL } from "bun";
import { generateNKeysBetween } from "fractional-indexing";

import { branchName } from "~/lib/branch";
import { suggestKey } from "~/lib/workspace";
import type { Actor } from "~/server/api.server";
import { uploadFile } from "~/server/attachments.server";
import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { createIssue } from "~/server/issues.server";
import { insertProject } from "~/server/projects.server";
import { putPage } from "~/server/wiki.server";

const screenshots = {
  board: "Project board",
  issue: "Issue with its pull request and CI checks",
  search: "Command menu",
  wiki: "Wiki page",
};

type Screenshot = keyof typeof screenshots;

export const insertDemoProject = async (
  tx: TransactionSQL,
  workspaceId: string,
  workspaceName: string
) => {
  const suggested = suggestKey(workspaceName);
  const base = /^[A-Z][A-Z0-9]/u.test(suggested) ? suggested : "START";

  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? "" : String(attempt);
    const key = `${base.slice(0, 5 - suffix.length)}${suffix}`;

    // oxlint-disable-next-line no-await-in-loop -- Each attempt waits for the previous key's unique check.
    const id = await insertProject(tx, workspaceId, {
      color: "green",
      icon: "rocket",
      key,
      name: "Getting started",
    });

    if (id !== null) {
      return key;
    }
  }
};

const guide = (
  key: string,
  branch: string,
  image: (name: Screenshot) => string
) => `Flint keeps a team's issues and docs in one place and links them to Gitea, so branches, pull requests and CI runs show up on the issue they belong to. This page explains the basics; the issues in **Getting started**, from ${key}-1, turn them into steps.

## Issues and projects

Press \`C\` anywhere to create an issue; a title is enough. On an issue, \`S\` sets the status, \`P\` the priority, \`A\` the assignee (\`I\` assigns it to you) and \`L\` the labels. Descriptions and comments are Markdown: \`/\` opens the block menu, \`@\` mentions an issue or a page, and images and files go in by paste or drop. Edits save as you type, and the activity log shows who changed what.

Projects group issues and number them by key, such as \`${key}-1\`. Create one with **+** next to **Projects** in the sidebar; the key is unique across Flint and never changes.

## Keyboard and Cmd+K

\`Cmd+K\` (\`Ctrl+K\` on Windows and Linux) opens the command menu: search issues and pages, jump anywhere, and run any action on the selected issues. \`?\` lists every shortcut.

${image("search")}

| Keys | Action |
| --- | --- |
| \`C\` | Create an issue |
| \`J\` / \`K\` | Next or previous issue |
| \`X\` | Select the issue under the pointer |
| \`S\` \`P\` \`A\` \`L\` | Status, priority, assignee, labels |
| \`G\` then \`M\` | My issues |
| \`G\` then \`W\` | Wiki |
| \`Cmd+Backspace\` | Delete the issue |

## Board

Every project has a list and a board; \`Cmd+B\` switches between them. Drag cards between columns and press \`F\` to filter by label, assignee or priority. Done and canceled issues leave the board after two weeks.

${image("board")}

## Pull requests and CI

Flint listens to Gitea. Put an issue key in a branch name, a commit message or a pull request title, and the issue lists the branch, commits and pull request under **Development** with their CI checks. \`Cmd+Shift+.\` on an issue copies a branch name such as \`${branch}\`.

${image("issue")}

## Wiki

The wiki belongs to the whole workspace. Pages nest in folders, keep every revision (**Show history** in a page's \`…\` menu), hold images and files, and turn an issue key such as ${key}-1 into a live link. Create a page with **New page** in the sidebar or **Create wiki page** in \`Cmd+K\`.

${image("wiki")}

## Trash

Deleted issues and pages wait in **Settings › Trash** (\`G\` then \`T\`) for ${env.TRASH_RETENTION_DAYS} days, so you can restore them, and then Flint removes them for good. After a delete, **Undo** in the toast brings the issue back at once.

## CLI and coding agents

The \`flint\` CLI does everything the web app does and prints JSON when piped. Create a key under **Settings › API keys**, then:

\`\`\`sh
npm install -g @yusoltsev/flint-cli
flint login --url ${env.APP_URL} --token <key>
flint issue list -a @me
\`\`\`

Coding agents use the same CLI. \`npx skills add yegor-usoltsev/flint\` installs a skill that tells the agent to run \`flint skill\`, which prints a guide for the installed version. Give each agent a key restricted to the workspaces it needs.`;

const prTitle = "Link a pull request to an issue";

const steps = (key: string, branch: string, guideLink: string) => [
  {
    description: `**Getting started** is a sample project. Create one for your team's real work, then delete this one under **Settings › Projects** when you finish these steps.

- [ ] Click **+** next to **Projects** in the sidebar and pick a short key, such as \`WEB\`
- [ ] Press \`C\` and add the first few issues
- [ ] Set a priority with \`P\` and assign one to yourself with \`I\`

More in ${guideLink}.`,
    title: "Create a project for your team",
  },
  {
    description: `Add people under **Settings › Members** by their Gitea username. Someone who has not signed in to Flint yet joins the workspace on their first sign-in.

- [ ] Add your teammates
- [ ] Make another admin, so the workspace never depends on one person`,
    title: "Invite your teammates",
  },
  {
    description: `Most of Flint works from the keyboard.

- [ ] Press \`?\` and skim the shortcuts
- [ ] Open \`Cmd+K\` (\`Ctrl+K\` on Windows and Linux) and find ${key}-1
- [ ] Select two issues with \`X\` and change their priority at once
- [ ] Switch this project to the board with \`Cmd+B\` and drag a card

More in ${guideLink}.`,
    title: "Try the keyboard shortcuts and Cmd+K",
  },
  {
    description: `Flint links branches, commits and pull requests that mention an issue key, and shows their CI checks on the issue.

- [ ] Press \`Cmd+Shift+.\` on this issue to copy its branch name (\`${branch}\`)
- [ ] Push a branch with that name to a repository on Gitea
- [ ] Open a pull request and watch it appear under **Development**

More in ${guideLink}.`,
    title: prTitle,
  },
  {
    description: `The \`flint\` CLI does everything the web app does, for scripts and coding agents.

- [ ] Create an API key under **Settings › API keys**
- [ ] \`npm install -g @yusoltsev/flint-cli\` and \`flint login --url ${env.APP_URL} --token <key>\`
- [ ] \`npx skills add yegor-usoltsev/flint\` to teach your coding agent, which then runs \`flint skill\`

More in ${guideLink}.`,
    title: "Set up the CLI and your coding agent",
  },
];

export const addDemoData = async (actor: Actor, slug: string, key: string) => {
  const [user] = await db<{ username: string }[]>`
    select username from users where id = ${actor.userId}
  `;

  const branch = branchName(user?.username ?? "", `${key}-4`, prTitle);
  const target = { path: "getting-started", slug };
  const title = "Getting started with Flint";
  const page = await putPage(actor, target, { title });

  const images = new Map<string, string>();

  for (const [name, alt] of Object.entries(screenshots)) {
    // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- A failed upload must leave none in flight for the workspace cleanup.
    const attachment = await uploadFile(
      actor,
      { pageId: page.id },
      new File([Bun.file(`assets/screenshots/${name}.webp`)], `${name}.webp`, {
        type: "image/webp",
      })
    );

    images.set(name, `![${alt}](${attachment.url})`);
  }

  await putPage(actor, target, {
    body: guide(key, branch, (name) => images.get(name) ?? ""),
  });

  const issues = steps(key, branch, `[${title}](/doc/${page.id})`);
  const sortKeys = generateNKeysBetween(null, null, issues.length);

  for (const [index, issue] of issues.entries()) {
    // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- Issue numbers follow the steps' order.
    await createIssue(actor, key, {
      ...issue,
      assigneeId: actor.userId,
      labelIds: [],
      priority: 0,
      sortKey: sortKeys[index],
    });
  }

  await db`
    update issues i set updated_at = i.updated_at - i.number * interval '1 second'
    from projects p
    where p.id = i.project_id and p.key = ${key}
  `;
};
