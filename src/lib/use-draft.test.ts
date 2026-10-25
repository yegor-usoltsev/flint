import { afterEach, beforeEach, expect, test } from "bun:test";

import { notifyManager } from "@tanstack/react-query";

import {
  discardDraft,
  editDraft,
  readDraft,
  settleDraft,
} from "~/lib/use-draft";

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

test("a save from before a discard never clears the same text retyped", () => {
  editDraft("retype:body", "A", "");
  settleDraft("retype:body", "A");
  discardDraft("retype:body");
  editDraft("retype:body", "A", "");
  drain();

  expect(readDraft("retype:body")).toMatchObject({ base: "A", text: "A" });
});
