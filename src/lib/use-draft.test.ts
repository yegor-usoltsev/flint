import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { notifyManager } from "@tanstack/react-query";

import { toast } from "~/components/ui/toast";
import { ApiError } from "~/lib/api";
import {
  adoptDrafts,
  discardDraft,
  editDraft,
  holdEdits,
  isRetryableDraftError,
  readDraft,
  settleDraft,
} from "~/lib/use-draft";

test.each([
  [new TypeError("Network unavailable"), true],
  [new ApiError(503, { code: "http_error", message: "Unavailable" }), true],
  [new ApiError(429, { code: "rate_limit", message: "Slow down" }), true],
  [new ApiError(400, { code: "invalid_request", message: "Too long" }), false],
  [new ApiError(401, { code: "unauthorized", message: "Sign in" }), false],
  [new ApiError(403, { code: "forbidden", message: "Denied" }), false],
  [new ApiError(404, { code: "not_found", message: "Missing" }), false],
  [new ApiError(409, { code: "deleted", message: "Deleted" }), false],
  [
    new ApiError(409, { code: "user_changed", message: "Account changed" }),
    false,
  ],
  [new Error("Invalid text"), false],
])("only transient draft failures can retry: %s", (failure, expected) => {
  expect(isRetryableDraftError(failure)).toBe(expected);
});

let scheduled: (() => void)[] = [];

const drain = () => {
  const tasks = scheduled;

  scheduled = [];

  for (const task of tasks) {
    task();
  }
};

beforeEach(() => {
  notifyManager.setScheduler((task) => {
    scheduled.push(task);
  });
});

afterEach(() => {
  drain();
  notifyManager.setScheduler((task) => {
    setTimeout(task, 0);
  });
});

test("a save clears its draft only after the cache has been told", () => {
  editDraft("page:body", "A", "");
  settleDraft("page:body", "A");

  expect(readDraft("page:body")?.text).toBe("A");

  drain();

  expect(readDraft("page:body")).toBeUndefined();
});

test("an older save never clears text typed after it", () => {
  editDraft("race:body", "A", "");
  settleDraft("race:body", "A");
  editDraft("race:body", "B", "");
  settleDraft("race:body", "B");
  editDraft("race:body", "A", "");
  drain();

  expect(readDraft("race:body")).toMatchObject({
    base: "B",
    status: "pending",
    text: "A",
  });
});

test("queued saves clear the draft once the last one is told", () => {
  editDraft("queue:body", "A", "");
  settleDraft("queue:body", "A");
  editDraft("queue:body", "B", "");
  settleDraft("queue:body", "B");
  drain();

  expect(readDraft("queue:body")).toBeUndefined();
});

test("a save that answers while an editor holds newer text keeps that text as a draft", () => {
  editDraft("held:body", "A", "");
  settleDraft("held:body", "A");

  let held: string | null = "AB";

  const release = holdEdits("held:body", () => {
    if (held !== null) {
      editDraft("held:body", held, "");
      held = null;
    }
  });

  drain();
  release();

  expect(readDraft("held:body")).toMatchObject({
    base: "A",
    status: "pending",
    text: "AB",
  });

  discardDraft("held:body");
});

test("a save from before a discard never clears the same text retyped", () => {
  editDraft("retype:body", "A", "");
  settleDraft("retype:body", "A");
  discardDraft("retype:body");
  editDraft("retype:body", "A", "");
  drain();

  expect(readDraft("retype:body")).toMatchObject({ base: "A", text: "A" });
});

test("a deferred save cannot change another account's draft", () => {
  adoptDrafts("alice");
  editDraft("account:body", "Alice's edit", "Alice's base");
  settleDraft("account:body", "Alice's edit");
  adoptDrafts("bob");
  editDraft("account:body", "Bob's edit", "Bob's base");
  drain();

  expect(readDraft("account:body")).toMatchObject({
    base: "Bob's base",
    text: "Bob's edit",
  });
});

test("changing accounts does not expose the previous account's text", () => {
  adoptDrafts("alice");
  editDraft("preserve:body", "Unsaved text", "Original");

  const add = spyOn(toast, "add").mockReturnValue("account-change");

  try {
    adoptDrafts("bob");
    expect(readDraft("preserve:body")).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  } finally {
    add.mockRestore();
  }
});

test("text an editor holds when the account changes never reaches the next account", () => {
  adoptDrafts("alice");

  let held: string | null = "Alice's text";

  const release = holdEdits("account:body", () => {
    if (held !== null) {
      editDraft("account:body", held, "");
      held = null;
    }
  });

  adoptDrafts("bob");
  release();

  expect(readDraft("account:body")).toBeUndefined();
});
