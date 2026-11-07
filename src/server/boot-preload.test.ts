import { expect, test } from "bun:test";

import { bootPreloads } from "~/server/boot-preload.server";

test("pages preload the requests their first render waits for", () => {
  expect(bootPreloads("/")).toBe(
    "</api/v1/me>; rel=preload; as=fetch; crossorigin"
  );
  expect(bootPreloads("/acme/my-issues")?.split(", ")).toEqual([
    "</api/v1/me>; rel=preload; as=fetch; crossorigin",
    "</api/v1/workspaces/acme/projects?counts=false>; rel=preload; as=fetch; crossorigin",
    "</api/v1/workspaces/acme/labels?counts=false>; rel=preload; as=fetch; crossorigin",
    "</api/v1/workspaces/acme/members>; rel=preload; as=fetch; crossorigin",
  ]);
  expect(bootPreloads("/doc/123")).toBeNull();
  expect(bootPreloads("/Not%20a%20slug")).toBeNull();
});
