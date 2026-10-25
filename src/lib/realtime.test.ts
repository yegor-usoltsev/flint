import { expect, test } from "bun:test";

import { eventKeys } from "~/lib/realtime";

test("issue and project events refresh the settings counters", () => {
  const issue = eventKeys("acme", {
    entity: "issue",
    id: "i1",
    projectId: "p1",
  });

  const project = eventKeys("acme", {
    entity: "project",
    id: "p1",
    projectId: "p1",
  });

  expect(issue).toContainEqual(["workspaces", "acme", "projects"]);
  expect(issue).toContainEqual(["workspaces", "acme", "labels"]);
  expect(project).toContainEqual(["workspaces", "acme", "labels"]);
  expect(issue).toContainEqual(["workspaces", "acme", "trash"]);
  expect(
    eventKeys("acme", { entity: "wiki", id: "w1", projectId: null })
  ).toContainEqual(["workspaces", "acme", "trash"]);
});
