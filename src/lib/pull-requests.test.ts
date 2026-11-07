import { expect, test } from "bun:test";

import type { GitLink } from "~/lib/api-types";
import {
  checksSummary,
  developmentSummary,
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

const gitLink = (link: Partial<GitLink>): GitLink => ({
  authorLogin: null,
  checks: [],
  ciState: null,
  externalId: "1",
  headSha: null,
  id: crypto.randomUUID(),
  kind: "commit",
  occurredAt: "2026-11-07T00:00:00Z",
  repo: "acme/web",
  repoUrl: "https://git.example/acme/web",
  state: null,
  title: "Change",
  url: "https://git.example/acme/web",
  ...link,
});

test("the development summary leads with the pull request and its checks", () => {
  expect(developmentSummary([])).toBeNull();
  expect(
    developmentSummary([
      gitLink({ ciState: "failure" }),
      gitLink({ kind: "branch" }),
      gitLink({
        ciState: "success",
        externalId: "7",
        kind: "pull_request",
        state: "open",
      }),
      gitLink({ externalId: "9", kind: "pull_request", state: "merged" }),
    ])
  ).toMatchObject({ checks: "checks passed", text: "PR #7 open +1" });
  expect(
    developmentSummary([gitLink({ kind: "branch" }), gitLink({})])
  ).toMatchObject({ checks: null, text: "1 branch" });
  expect(
    developmentSummary([gitLink({ ciState: "pending" }), gitLink({})])
  ).toMatchObject({ checks: "checks running", text: "2 commits" });
});
