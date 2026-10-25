import { expect, test } from "bun:test";

import {
  checksSummary,
  isWebUrl,
  newPullRequestUrl,
  settledChecks,
} from "~/lib/pull-requests";

test("a checks summary counts states from the worst one", () => {
  expect(
    checksSummary([
      { state: "success" },
      { state: "failure" },
      { state: "pending" },
      { state: "success" },
    ])
  ).toBe("4 checks · 1 failed, 1 running, 2 passed");
  expect(checksSummary([{ state: "warning" }])).toBe("1 check · 1 warning");
});

test("only passed and skipped checks count as settled", () => {
  expect(settledChecks([{ state: "success" }, { state: "skipped" }])).toBe(
    true
  );
  expect(settledChecks([{ state: "success" }, { state: "warning" }])).toBe(
    false
  );
});

test("check links open only web URLs", () => {
  expect(isWebUrl("https://ci.test/run/1")).toBe(true);
  expect(isWebUrl("ftp://ci.test/run/1")).toBe(false);
  expect(isWebUrl("")).toBe(false);
});

test("a new pull request URL keeps the branch's slashes", () => {
  expect(
    newPullRequestUrl("https://git.test/acme/app", "alice/ENG-1-fix #2")
  ).toBe("https://git.test/acme/app/pulls/new/alice/ENG-1-fix%20%232");
});
