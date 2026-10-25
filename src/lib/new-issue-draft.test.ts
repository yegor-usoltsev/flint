import { afterEach, expect, test } from "bun:test";

import {
  createError,
  emptyText,
  readDraft,
  restoreSubmitted,
  savedProperties,
  settleSubmitted,
  writeDraft,
} from "~/lib/new-issue-draft";
import type { Submitted } from "~/lib/new-issue-draft";

const properties = {
  assigneeId: null,
  labelIds: ["bug"],
  priority: 2,
  statusId: "todo",
} as const;

const submitted: Submitted = {
  projectKey: "ENG",
  properties: { ...properties, labelIds: [...properties.labelIds] },
  text: { description: "Steps", title: "Crash" },
};

afterEach(() => {
  settleSubmitted(submitted);
  writeDraft("ENG", emptyText);
  savedProperties.clear();
});

test("a created issue clears only the text and properties it was created from", () => {
  writeDraft("ENG", submitted.text);
  savedProperties.set("ENG", submitted.properties);
  settleSubmitted(submitted);

  expect(readDraft("ENG")).toEqual(emptyText);
  expect(savedProperties.has("ENG")).toBe(false);

  writeDraft("ENG", { description: "Steps, then more", title: "Crash" });
  savedProperties.set("ENG", { ...submitted.properties, priority: 1 });
  settleSubmitted(submitted);

  expect(readDraft("ENG")).toEqual({
    description: "Steps, then more",
    title: "",
  });
  expect(savedProperties.get("ENG")?.priority).toBe(1);
});

test("a failed create keeps the draft and brings back a cleared one", () => {
  writeDraft("ENG", submitted.text);
  restoreSubmitted(submitted, "Invalid length");

  expect(readDraft("ENG")).toEqual(submitted.text);
  expect(createError("ENG")).toBe("Invalid length");

  writeDraft("ENG", emptyText);
  restoreSubmitted(submitted, null);

  expect(readDraft("ENG")).toEqual(submitted.text);
  expect(savedProperties.get("ENG")).toEqual(submitted.properties);
  expect(createError("ENG")).toBeNull();

  writeDraft("ENG", { description: "", title: "Next issue" });
  restoreSubmitted(submitted, null);

  expect(readDraft("ENG")).toEqual({ description: "", title: "Next issue" });
});

test("a successful create clears the error", () => {
  restoreSubmitted(submitted, "Invalid length");
  settleSubmitted(submitted);

  expect(createError("ENG")).toBeNull();
});
