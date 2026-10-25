import { expect, test } from "bun:test";

import { isAppPath } from "~/lib/back-to-app";

test("only workspace pages outside settings count as app locations", () => {
  expect(isAppPath("/acme/project/ENG", "acme")).toBe(true);
  expect(isAppPath("/acme/my-issues", "acme")).toBe(true);
  expect(isAppPath("/acme/settings", "acme")).toBe(false);
  expect(isAppPath("/acme/settings/account/preferences", "acme")).toBe(false);
  expect(isAppPath("/acme/settings-old", "acme")).toBe(true);
  expect(isAppPath("/globex/project/OPS", "acme")).toBe(false);
});
