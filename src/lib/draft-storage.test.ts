import { afterAll, beforeEach, expect, test } from "bun:test";

import { clearStoredDrafts, readStoredDrafts } from "~/lib/draft-storage";
import {
  adoptDrafts,
  discardDraft,
  editDraft,
  readDraft,
  readStoredText,
  setStoredText,
} from "~/lib/use-draft";

const items = new Map<string, string>();

const memoryStorage: Storage = {
  clear: () => {
    items.clear();
  },
  getItem: (name) => items.get(name) ?? null,
  key: (index) => [...items.keys()][index] ?? null,
  get length() {
    return items.size;
  },
  removeItem: (name) => {
    items.delete(name);
  },
  setItem: (name, value) => {
    items.set(name, value);
  },
};

globalThis.localStorage = memoryStorage;

afterAll(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

beforeEach(() => {
  items.clear();
});

interface RawEntry {
  at?: number;
  base?: string;
  rev?: string;
  text: string;
  user?: string;
}

const store = (key: string, entry: RawEntry) => {
  items.set(`flint-draft:${key}`, JSON.stringify({ rev: "r1", ...entry }));
};

const settle = async () => {
  await Bun.sleep(350);
};

test("only the signed-in user's recent drafts come back", () => {
  store("new-comment:1", { at: Date.now(), text: "mine", user: "alice" });
  store("new-comment:2", { at: Date.now(), text: "theirs", user: "bob" });
  store("new-comment:3", { at: 0, text: "stale", user: "alice" });
  store("new-comment:7", { text: "broken" });

  expect([...readStoredDrafts("alice")]).toEqual([
    ["new-comment:1", { text: "mine" }],
  ]);
  expect([...items.keys()]).toEqual(["flint-draft:new-comment:1"]);
});

test("adopted drafts restore unsent text and unsaved edits, and later edits persist", async () => {
  store("new-comment:5", { at: Date.now(), text: "hello", user: "carol" });
  store("issue:5:description", {
    at: Date.now(),
    base: "old",
    text: "new",
    user: "carol",
  });

  adoptDrafts("carol");

  expect(readStoredText("new-comment:5")).toBe("hello");
  expect(readDraft("issue:5:description")).toMatchObject({
    base: "old",
    status: "error",
    text: "new",
  });

  setStoredText("new-comment:5", "\n");
  editDraft("issue:5:title", "Title", "");
  await settle();

  expect(readStoredDrafts("carol")).toEqual(
    new Map([
      ["issue:5:description", { base: "old", text: "new" }],
      ["issue:5:title", { base: "", text: "Title" }],
    ])
  );

  discardDraft("issue:5:title");
  discardDraft("issue:5:description");
  await settle();
  expect(items.size).toBe(0);
});

test("submitting a stale composer keeps the text another tab stored since", async () => {
  setStoredText("new-comment:8", "mine");
  await settle();
  store("new-comment:8", {
    at: Date.now(),
    rev: "other-tab",
    text: "newer",
    user: "carol",
  });
  setStoredText("new-comment:8", null);
  await settle();

  expect(readStoredDrafts("carol").get("new-comment:8")).toEqual({
    text: "newer",
  });
});

test("a status change does not rewrite text another tab stored since", async () => {
  editDraft("issue:11:description", "mine", "");
  await settle();
  store("issue:11:description", {
    at: Date.now(),
    base: "",
    rev: "other-tab",
    text: "newer",
    user: "carol",
  });
  editDraft("issue:11:description", "mine", "");
  await settle();

  expect(readStoredDrafts("carol").get("issue:11:description")).toEqual({
    base: "",
    text: "newer",
  });

  discardDraft("issue:11:description");
  await settle();
});

test("entries stored before revisions existed still come back", () => {
  items.set(
    "flint-draft:new-comment:12",
    JSON.stringify({ at: Date.now(), text: "old", user: "carol" })
  );

  expect(readStoredDrafts("carol").get("new-comment:12")).toEqual({
    text: "old",
  });
});

test("signing out forgets drafts in memory and stops pending writes", async () => {
  setStoredText("new-comment:9", "secret");
  clearStoredDrafts();
  await settle();

  expect(readStoredText("new-comment:9")).toBeNull();
  expect(items.size).toBe(0);

  adoptDrafts("carol");
});

test("another account in the same tab starts without the previous drafts", () => {
  setStoredText("new-comment:10", "carol's");
  adoptDrafts("dave");

  expect(readStoredText("new-comment:10")).toBeNull();
  expect(readStoredDrafts("dave").size).toBe(0);

  adoptDrafts("carol");
});

test("signing out clears every stored draft", () => {
  store("new-comment:6", { at: Date.now(), text: "x", user: "alice" });
  items.set("theme", "dark");
  clearStoredDrafts();
  expect([...items.keys()]).toEqual(["theme"]);
});
