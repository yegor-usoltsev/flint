import { beforeEach, expect, test } from "bun:test";

import { createIssue, deleteIssue, updateIssue } from "~/server/issues.server";
import { createLabel, listLabels } from "~/server/labels.server";
import { listMembers } from "~/server/members.server";
import {
  createProject,
  getProject,
  listProjects,
} from "~/server/projects.server";
import { createWorkspace } from "~/server/workspaces.server";

import { createUser, resetDatabase } from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
});

const issue = (labelIds: string[]) => ({
  assigneeId: null,
  description: "",
  labelIds,
  priority: 0 as const,
  title: "Counted",
});

test("settings lists carry open issue counts, label usage and join dates", async () => {
  const actor = { userId: await createUser("root") };

  await createWorkspace(actor, { name: "Acme", slug: "acme" });
  await createProject(actor, "acme", { color: "blue", key: "ENG", name: "E" });
  await createProject(actor, "acme", { color: "red", key: "OPS", name: "O" });

  const crash = await createLabel(actor, "acme", {
    color: "red",
    name: "Crash",
  });

  await createLabel(actor, "acme", { color: "blue", name: "Docs" });

  const open = await createIssue(actor, "ENG", issue([crash.id]));
  const done = await createIssue(actor, "ENG", issue([crash.id]));
  const gone = await createIssue(actor, "ENG", issue([crash.id]));
  const { statuses } = await getProject(actor, "ENG");
  const completed = statuses.find((status) => status.category === "completed");

  await updateIssue(actor, done.key, { statusId: completed?.id });
  await deleteIssue(actor, gone.key);

  expect(open.key).toBe("ENG-1");
  const projects = [...(await listProjects(actor, "acme"))];
  const members = [...(await listMembers(actor, "acme"))];

  expect(projects).toMatchObject([
    { key: "ENG", openIssues: 1 },
    { key: "OPS", openIssues: 0 },
  ]);
  expect([...(await listLabels(actor, "acme"))]).toMatchObject([
    { issueCount: 0, name: "Bug" },
    { issueCount: 2, name: "Crash" },
    { issueCount: 0, name: "Docs" },
    { issueCount: 0, name: "Feature" },
    { issueCount: 0, name: "Improvement" },
  ]);
  expect(projects[0]?.createdAt).toBeTruthy();
  expect(members).toMatchObject([{ username: "root" }]);
  expect(members[0]?.joinedAt).toBeTruthy();
});
