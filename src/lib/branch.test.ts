import { expect, test } from "bun:test";

import { branchName } from "~/lib/branch";

test("branch names are the username, the key and a word-bounded title slug", () => {
  expect(branchName("alice", "ENG-1", "Fix login redirect loop")).toBe(
    "alice/ENG-1-fix-login-redirect-loop"
  );
  expect(branchName("alice", "eng-12", "Fix: login → redirect (Café)")).toBe(
    "alice/ENG-12-fix-login-redirect-cafe"
  );
  expect(
    branchName(
      "bob",
      "ENG-1",
      "Fix login redirect loop when the session cookie expires mid-request"
    )
  ).toBe("bob/ENG-1-fix-login-redirect-loop-when-the-session-cookie");
  expect(branchName("alice", "ENG-3", "Привет")).toBe("alice/ENG-3");
  expect(branchName("", "ENG-3", "Fix it")).toBe("ENG-3-fix-it");
});
