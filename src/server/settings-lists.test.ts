import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import { createIssue, deleteIssue, updateIssue } from "~/server/issues.server";
import { createLabel, listLabels, updateLabel } from "~/server/labels.server";
import { addMember, listMembers } from "~/server/members.server";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "~/server/projects.server";
import { createWorkspace } from "~/server/workspaces.server";

import { createUser, resetDatabase, stubGiteaUsers } from "../../test/helpers";

beforeEach(async () => {
  await resetDatabase();
  stubGiteaUsers();
});

afterEach(() => {
  mock.restore();
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
  const projects = [...(await listProjects(actor, "acme", true))];
  const members = [...(await listMembers(actor, "acme"))];

  expect(projects).toMatchObject([
    { key: "ENG", openIssues: 1 },
    { key: "OPS", openIssues: 0 },
  ]);
  const [plainProject] = await listProjects(actor, "acme");
  const [plainLabel] = await listLabels(actor, "acme");

  expect(plainProject).not.toHaveProperty("openIssues");
  expect(plainLabel).not.toHaveProperty("issueCount");
  expect([...(await listLabels(actor, "acme", true))]).toMatchObject([
    { issueCount: 0, name: "Bug" },
    { issueCount: 0, name: "Feature" },
    { issueCount: 0, name: "Improvement" },
    { issueCount: 2, name: "Crash" },
    { issueCount: 0, name: "Docs" },
  ]);
  expect(projects[0]?.createdAt).toBeTruthy();
  expect(members).toMatchObject([{ username: "root" }]);
  expect(members[0]?.joinedAt).toBeTruthy();
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
};

test("admins reorder projects and members reorder labels for the whole workspace", async () => {
  const root = { userId: await createUser("root") };
  const alice = { userId: await createUser("alice") };

  await createWorkspace(root, { name: "Acme", slug: "acme" });
  await createWorkspace(root, { name: "Globex", slug: "globex" });
  await addMember(root, "acme", { role: "member", username: "alice" });

  for (const key of ["AAA", "BBB", "CCC"]) {
    // oxlint-disable-next-line no-await-in-loop -- Creation order sets the initial order.
    await createProject(root, "acme", { color: "blue", key, name: key });
  }

  await createProject(root, "globex", { color: "red", key: "GLO", name: "G" });

  const keys = async () => {
    const projects = await listProjects(alice, "acme");

    return projects.map((project) => project.key);
  };

  const names = async () => {
    const labels = await listLabels(alice, "acme");

    return labels.map((label) => label.name);
  };

  await updateProject(root, "AAA", { after: "CCC" });
  expect(await keys()).toEqual(["BBB", "CCC", "AAA"]);

  await updateProject(root, "CCC", { after: null });
  expect(await keys()).toEqual(["CCC", "BBB", "AAA"]);

  expect(
    await failure(updateProject(alice, "AAA", { after: null }))
  ).toMatchObject({ status: 403 });
  expect(
    await failure(updateProject(root, "AAA", { after: "GLO" }))
  ).toMatchObject({ status: 404 });
  expect(await keys()).toEqual(["CCC", "BBB", "AAA"]);

  const [bug, feature, improvement] = await listLabels(alice, "acme");
  const [foreign] = await listLabels(root, "globex");

  await updateLabel(alice, bug?.id.toUpperCase() ?? "", {
    after: improvement?.id.toUpperCase() ?? "",
  });
  expect(await names()).toEqual(["Feature", "Improvement", "Bug"]);
  expect(
    await failure(
      updateLabel(alice, feature?.id ?? "", { after: foreign?.id ?? "" })
    )
  ).toMatchObject({ status: 404 });

  await createLabel(alice, "acme", { color: "green", name: "Docs" });
  expect(await names()).toEqual(["Feature", "Improvement", "Bug", "Docs"]);
});

test("concurrent moves keep both changes", async () => {
  const root = { userId: await createUser("root") };

  await createWorkspace(root, { name: "Acme", slug: "acme" });

  const [bug, feature, improvement] = await listLabels(root, "acme");

  for (let round = 0; round < 10; round += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Each round resets the order before racing two moves.
    await updateLabel(root, improvement?.id ?? "", {
      after: feature?.id ?? "",
    });
    // oxlint-disable-next-line no-await-in-loop -- The two moves race within a round.
    await Promise.all([
      updateLabel(root, improvement?.id ?? "", { after: null }),
      updateLabel(root, feature?.id ?? "", { after: bug?.id ?? "" }),
    ]);

    // oxlint-disable-next-line no-await-in-loop -- Checks this round's result.
    const labels = await listLabels(root, "acme");

    expect(labels.map((label) => label.name)).toEqual([
      "Improvement",
      "Bug",
      "Feature",
    ]);
  }
});
