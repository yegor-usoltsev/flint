import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { deleteAttachment, uploadFile } from "~/server/attachments.server";
import {
  createComment,
  deleteComment,
  updateComment,
} from "~/server/comments.server";
import { db } from "~/server/db.server";
import {
  createIssue,
  deleteIssue,
  restoreIssue,
  updateIssue,
} from "~/server/issues.server";
import { createLabel, deleteLabel, updateLabel } from "~/server/labels.server";
import { addMember, removeMember, updateMember } from "~/server/members.server";
import {
  createProject,
  deleteProject,
  updateProject,
} from "~/server/projects.server";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Spying on publish needs the module namespace.
import * as realtime from "~/server/realtime.server";
import { purgeIssue } from "~/server/trash.server";
import {
  deletePageById,
  movePage,
  patchPage,
  purgePage,
  putPage,
  restorePage,
} from "~/server/wiki.server";
import { createWorkspace, updateWorkspace } from "~/server/workspaces.server";

import { createUser, resetDatabase, stubGiteaUsers } from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  mock.restore();
});

const trackTransactions = () => {
  const state = { open: 0 };
  const begin = db.begin.bind(db);

  spyOn(db, "begin").mockImplementation(
    async <T>(
      ...args:
        | [Bun.SQL.TransactionContextCallback<T>]
        | [string, Bun.SQL.TransactionContextCallback<T>]
    ) => {
      state.open += 1;

      try {
        return await (args.length === 1 ? begin(args[0]) : begin(...args));
      } finally {
        state.open -= 1;
      }
    }
  );

  return state;
};

test("every change publishes its event only after its transaction commits", async () => {
  const transactions = trackTransactions();
  const published: { entity: string; open: number }[] = [];

  spyOn(realtime, "publish").mockImplementation((_workspaceId, event) => {
    published.push({ entity: event.entity, open: transactions.open });
  });
  spyOn(realtime, "publishToUser").mockImplementation((_userId, event) => {
    published.push({ entity: event.entity, open: transactions.open });
  });

  const root = { userId: await createUser("root") };

  await createUser("alice");
  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await updateWorkspace(root, "acme", { name: "Acme Corp" });
  await addMember(root, "acme", { role: "member", username: "alice" });
  await updateMember(root, "acme", "alice", { role: "admin" });
  await removeMember(root, "acme", "alice");
  await createProject(root, "acme", { color: "blue", key: "ENG", name: "E" });
  await updateProject(root, "ENG", { name: "Engineering" });

  const label = await createLabel(root, "acme", { color: "red", name: "Ops" });

  await updateLabel(root, label.id, { name: "Operations" });

  const issue = await createIssue(root, "ENG", {
    assigneeId: null,
    description: "",
    labelIds: [label.id],
    priority: 0,
    title: "Ship it",
  });

  await updateIssue(root, issue.key, { title: "Ship it today" });

  const comment = await createComment(root, issue.key, { body: "On it" });

  await updateComment(root, comment.id, { body: "Done" });
  await deleteComment(root, comment.id);

  const file = await uploadFile(
    root,
    { issueKey: issue.key },
    new File(["notes"], "notes.txt", { type: "text/plain" })
  );

  await deleteAttachment(root, file.id);
  await deleteLabel(root, label.id);
  await deleteIssue(root, issue.key);
  await restoreIssue(root, issue.key);
  await deleteIssue(root, issue.key);
  await purgeIssue(root, issue.key);

  const page = await putPage(root, { path: "doc", slug: "acme" }, {});

  await patchPage(root, { path: "doc", slug: "acme" }, { append: "more" });
  await movePage(root, page.id, { path: "guide" });
  await deletePageById(root, page.id);
  await restorePage(root, page.id);
  await deletePageById(root, page.id);
  await purgePage(root, page.id);
  await deleteProject(root, "ENG");

  expect(published.filter(({ open }) => open > 0)).toEqual([]);
  expect(new Set(published.map(({ entity }) => entity))).toEqual(
    new Set([
      "attachment",
      "comment",
      "issue",
      "label",
      "member",
      "project",
      "wiki",
      "workspace",
    ])
  );
});
