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
  restoreRevision,
} from "~/server/wiki.server";
import {
  createWorkspace,
  deleteWorkspace,
  removeLogo,
  setLogo,
  updateWorkspace,
} from "~/server/workspaces.server";

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

const logoRequest = async () => {
  const png = await Bun.file(
    `${import.meta.dir}/../../test/fixtures/noise.png`
  ).bytes();

  const form = new FormData();

  form.set("file", new File([png], "logo.png", { type: "image/png" }));

  const body = await new Response(form).arrayBuffer();
  const [delimiter = ""] = new TextDecoder().decode(body).split("\r\n", 1);

  return new Request("http://flint.test/logo", {
    body,
    headers: {
      "content-length": String(body.byteLength),
      "content-type": `multipart/form-data; boundary=${delimiter.slice(2)}`,
    },
    method: "PUT",
  });
};

test("every change publishes its event only after its transaction commits", async () => {
  const transactions = trackTransactions();
  const published: { entity: string; open: number }[] = [];
  const missing: string[] = [];

  const record = (event: { entity: string }) => {
    published.push({ entity: event.entity, open: transactions.open });
  };

  spyOn(realtime, "publish").mockImplementation((_workspaceId, event) => {
    record(event);
  });
  spyOn(realtime, "publishToUser").mockImplementation((_userId, event) => {
    record(event);
  });

  const change = async <Result>(
    name: string,
    entity: string,
    action: () => Promise<Result>
  ) => {
    const before = published.length;
    const result = await action();

    if (!published.slice(before).some((event) => event.entity === entity)) {
      missing.push(name);
    }

    return result;
  };

  const root = { userId: await createUser("root") };
  const alice = { userId: await createUser("alice") };
  const doc = { path: "doc", slug: "acme" };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await change(
    "rename workspace",
    "workspace",
    async () => await updateWorkspace(root, "acme", { name: "Acme Corp" })
  );
  await change(
    "set logo",
    "workspace",
    async () => await setLogo(root, "acme", await logoRequest())
  );
  await change(
    "remove logo",
    "workspace",
    async () => await removeLogo(root, "acme")
  );
  await change(
    "add member",
    "member",
    async () =>
      await addMember(root, "acme", { role: "member", username: "alice" })
  );
  await change(
    "change role",
    "member",
    async () => await updateMember(root, "acme", "alice", { role: "admin" })
  );
  await change(
    "create project",
    "project",
    async () =>
      await createProject(root, "acme", {
        color: "blue",
        key: "ENG",
        name: "E",
      })
  );
  await change(
    "rename project",
    "project",
    async () => await updateProject(root, "ENG", { name: "Engineering" })
  );

  const label = await change(
    "create label",
    "label",
    async () => await createLabel(root, "acme", { color: "red", name: "Ops" })
  );

  await change(
    "rename label",
    "label",
    async () => await updateLabel(root, label.id, { name: "Operations" })
  );

  const issue = await change(
    "create issue",
    "issue",
    async () =>
      await createIssue(root, "ENG", {
        assigneeId: null,
        description: "",
        labelIds: [label.id],
        priority: 0,
        title: "Ship it",
      })
  );

  await change(
    "edit issue",
    "issue",
    async () => await updateIssue(root, issue.key, { title: "Ship it today" })
  );

  const comment = await change(
    "comment",
    "comment",
    async () => await createComment(root, issue.key, { body: "On it" })
  );

  await change(
    "edit comment",
    "comment",
    async () => await updateComment(root, comment.id, { body: "Done" })
  );
  await change("delete comment", "comment", async () => {
    await deleteComment(root, comment.id);
  });

  const file = await change(
    "upload",
    "attachment",
    async () =>
      await uploadFile(
        root,
        { issueKey: issue.key },
        new File(["notes"], "notes.txt", { type: "text/plain" })
      )
  );

  await change("delete upload", "attachment", async () => {
    await deleteAttachment(root, file.id);
  });
  await change("delete label", "label", async () => {
    await deleteLabel(root, label.id);
  });
  await change(
    "delete issue",
    "issue",
    async () => await deleteIssue(root, issue.key)
  );
  await change(
    "restore issue",
    "issue",
    async () => await restoreIssue(root, issue.key)
  );
  await deleteIssue(root, issue.key);
  await change("purge issue", "issue", async () => {
    await purgeIssue(root, issue.key);
  });

  const page = await change(
    "create page",
    "wiki",
    async () => await putPage(root, doc, { body: "first" })
  );

  await change(
    "append",
    "wiki",
    async () => await patchPage(alice, doc, { append: "second" })
  );
  await change(
    "restore revision",
    "wiki",
    async () => await restoreRevision(root, page.id, "1")
  );
  await change(
    "move page",
    "wiki",
    async () => await movePage(root, page.id, { path: "guide" })
  );
  await change("delete page", "wiki", async () => {
    await deletePageById(root, page.id);
  });
  await change(
    "restore page",
    "wiki",
    async () => await restorePage(root, page.id)
  );
  await deletePageById(root, page.id);
  await change("purge page", "wiki", async () => {
    await purgePage(root, page.id);
  });
  await change("delete project", "project", async () => {
    await deleteProject(root, "ENG");
  });
  await change("remove member", "member", async () => {
    await removeMember(root, "acme", "alice");
  });
  await change("delete workspace", "workspace", async () => {
    await deleteWorkspace(root, "acme");
  });

  expect(missing).toEqual([]);
  expect(published.filter(({ open }) => open > 0)).toEqual([]);
});
