import { expect, test } from "bun:test";

import type { Me } from "~/lib/api-types";
import {
  followWorkspace,
  slugProblem,
  nextWorkspace,
  withoutWorkspace,
} from "~/lib/workspace";

const workspaces = [{ slug: "acme" }, { slug: "globex" }, { slug: "initech" }];

test("after a delete the remembered workspace wins, unless it was deleted", () => {
  expect(nextWorkspace(workspaces, "acme", "initech")).toBe("initech");
  expect(nextWorkspace(workspaces, "acme", "acme")).toBe("globex");
  expect(nextWorkspace(workspaces, "globex", null)).toBe("acme");
});

test("deleting the last workspace leaves nowhere to go", () => {
  expect(nextWorkspace([{ slug: "acme" }], "acme", "acme")).toBeNull();
});

test("the deleted workspace leaves the cached /me", () => {
  const me = {
    avatarUrl: "",
    displayName: "Alice",
    email: "",
    giteaUrl: "http://gitea.test",
    trashDays: 30,
    id: "u",
    isInstanceAdmin: false,
    username: "alice",
    workspaces: [
      {
        color: "blue",
        id: "a",
        logoUrl: null,
        name: "A",
        role: "admin",
        slug: "a",
      },
      {
        color: "red",
        id: "b",
        logoUrl: null,
        name: "B",
        role: "member",
        slug: "b",
      },
    ],
  } satisfies Me;

  expect(withoutWorkspace(me, "a")?.workspaces.map(({ id }) => id)).toEqual([
    "b",
  ]);
  expect(withoutWorkspace(null, "a")).toBeNull();
});

test("an open workspace follows a new slug and reports a lost one", () => {
  const seen = { id: "w1", name: "Acme", slug: "acme" };

  expect(
    followWorkspace(seen, "acme", [{ id: "w1", slug: "acme-co" }])
  ).toEqual({ kind: "moved", slug: "acme-co" });
  expect(followWorkspace(seen, "acme", [{ id: "w2", slug: "globex" }])).toEqual(
    { kind: "gone", name: "Acme" }
  );
  expect(
    followWorkspace(seen, "typo", [{ id: "w1", slug: "acme" }])
  ).toBeNull();
  expect(followWorkspace(null, "acme", [])).toBeNull();
});

test("a slug the server would reject gets the reason before saving", () => {
  expect(slugProblem("acme-2")).toBeNull();
  expect(slugProblem("api")).toBe("/api is reserved by Flint");
  expect(slugProblem("Acme")).toBe(
    "Use lowercase letters, digits and single dashes"
  );
  expect(slugProblem("a--b")).toBe(
    "Use lowercase letters, digits and single dashes"
  );
});
