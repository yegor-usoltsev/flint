import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { clearRecent, forgetRecent, rememberRecent } from "~/lib/recent";
import type { RecentItem } from "~/lib/recent";

const items = new Map<string, string>();

const page = (path: string): RecentItem => ({
  href: `/doc/${path}`,
  kind: "page",
  label: path,
  title: path,
});

const stored = (slug: string) =>
  v
    .parse(
      v.array(v.object({ label: v.string() })),
      JSON.parse(items.get(`flint:recent:${slug}`) ?? "[]")
    )
    .map((item) => item.label);

beforeAll(() => {
  globalThis.localStorage = {
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
});

beforeEach(() => {
  items.clear();
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("forgetting a deleted page drops only the matching entries", () => {
  rememberRecent("acme", page("guides"));
  rememberRecent("acme", page("guides/faq"));
  rememberRecent("acme", page("notes"));

  forgetRecent("acme", (item) => item.label.startsWith("guides"));

  expect(stored("acme")).toEqual(["notes"]);
});

test("signing out clears every workspace's recent items and nothing else", () => {
  items.set("theme", "dark");
  rememberRecent("acme", page("notes"));
  rememberRecent("other", page("plans"));

  clearRecent();

  expect([...items.keys()]).toEqual(["theme"]);
});
