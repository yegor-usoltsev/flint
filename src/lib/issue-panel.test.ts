import { expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import {
  clampWidth,
  listMin,
  openPanel,
  panelIssue,
  panelMin,
  setPanelSpace,
  showFirstRow,
  stepFromPanel,
  syncPanelIssue,
} from "~/lib/issue-panel";

test("the panel width stays between its minimum and what leaves the list its minimum", () => {
  expect(clampWidth(null, 1400)).toBe(672);
  expect(clampWidth(100, 1400)).toBe(panelMin);
  expect(clampWidth(5000, 1400)).toBe(1400 - listMin);
  expect(clampWidth(5000, 2400)).toBe(1560);
  expect(clampWidth(600, panelMin + listMin)).toBe(panelMin);
});

test("on very wide screens the panel takes what the capped list leaves", () => {
  expect(clampWidth(null, 3600)).toBe(2160);
  expect(clampWidth(null, 1800)).toBe(864);
});

test("a board keeps a narrower panel so more columns fit", () => {
  expect(clampWidth(null, 3600, false)).toBe(1152);
  expect(clampWidth(null, 1800, false)).toBe(576);
});

test("a link replaces the panel issue, page changes keep it and a new scope clears it", () => {
  syncPanelIssue("ENG-1", "acme", "list", "/acme/project/ENG");
  expect(panelIssue()).toBe("ENG-1");

  syncPanelIssue(null, "acme", "list", "/acme/project/DES");
  expect(panelIssue()).toBe("ENG-1");

  syncPanelIssue("ENG-2", "acme", "list", "/acme/project/DES");
  expect(panelIssue()).toBe("ENG-2");

  syncPanelIssue(null, "acme", "wiki", "/acme/wiki");
  expect(panelIssue()).toBeNull();

  syncPanelIssue("ENG-3", "acme", "wiki", "/acme/wiki");
  syncPanelIssue(null, "other", "wiki", "/other/wiki");
  expect(panelIssue()).toBeNull();
});

const withBrowser = (run: (location: { href: string }) => void) => {
  const location = { href: "http://flint.test/acme/my-issues" };
  const items = new Map<string, string>();

  Object.assign(globalThis, {
    document: {
      activeElement: null,
      querySelectorAll: () => [{ dataset: { issue: "1" } }],
    },
    History: {
      prototype: {
        replaceState: (_state: null, _title: string, url: URL) => {
          location.href = url.href;
        },
      },
    },
    localStorage: {
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, value: string) => items.set(name, value),
    },
    window: { history: { state: null }, innerWidth: 1900, location },
  });

  try {
    run(location);
  } finally {
    for (const name of ["document", "History", "localStorage", "window"]) {
      Reflect.deleteProperty(globalThis, name);
    }
  }
};

const firstRowClient = () => {
  const queryClient = new QueryClient();

  queryClient.setQueryData(
    ["issues", "p"],
    [{ deletedAt: null, id: "1", key: "ENG-1" }]
  );

  return queryClient;
};

test("an automatic preview stays out of the URL until the user opens it", () => {
  withBrowser((location) => {
    const queryClient = firstRowClient();

    syncPanelIssue(null, "acme", "list", "/acme/my-issues");
    setPanelSpace(2000, true);

    expect(showFirstRow(queryClient)).toBe(true);
    expect(panelIssue()).toBe("ENG-1");
    expect(new URL(location.href).searchParams.has("issue")).toBe(false);

    openPanel("ENG-1");
    expect(new URL(location.href).searchParams.get("issue")).toBe("ENG-1");
  });
});

test("another list drops an automatic preview but keeps an opened issue", () => {
  withBrowser(() => {
    const queryClient = firstRowClient();

    syncPanelIssue(null, "acme", "list", "/acme/project/ENG");
    setPanelSpace(2000, true);
    expect(showFirstRow(queryClient)).toBe(true);

    syncPanelIssue(null, "acme", "list", "/acme/project/DES");
    expect(panelIssue()).toBeNull();

    openPanel("ENG-1");
    syncPanelIssue(null, "acme", "list", "/acme/project/ENG");
    expect(panelIssue()).toBe("ENG-1");
  });
});

test("stepping from a panel issue that has no row in the list stays put", () => {
  withBrowser(() => {
    const queryClient = firstRowClient();
    const focused: string[] = [];

    queryClient.setQueryData(
      ["issues", "q"],
      [{ deletedAt: null, id: "9", key: "AC-1" }]
    );

    Object.assign(globalThis.document, {
      querySelector: () => null,
      querySelectorAll: () => [
        { dataset: { issue: "1" }, focus: () => focused.push("1") },
      ],
    });
    Object.assign(globalThis, { CSS: { escape: (value: string) => value } });

    syncPanelIssue(null, "acme", "list", "/acme/project/ENG");
    setPanelSpace(2000, true);
    openPanel("AC-1");

    stepFromPanel(queryClient, 1);
    stepFromPanel(queryClient, -1);

    expect(focused).toEqual([]);
    expect(panelIssue()).toBe("AC-1");
  });

  Reflect.deleteProperty(globalThis, "CSS");
});
