import { expect, test } from "bun:test";

import {
  clampWidth,
  listMin,
  panelIssue,
  panelMin,
  syncPanelIssue,
} from "~/lib/issue-panel";

test("the panel width stays between its minimum and what leaves the list its minimum", () => {
  expect(clampWidth(null, 1400)).toBe(588);
  expect(clampWidth(100, 1400)).toBe(panelMin);
  expect(clampWidth(5000, 1400)).toBe(1400 - listMin);
  expect(clampWidth(5000, 2400)).toBe(1560);
  expect(clampWidth(600, panelMin + listMin)).toBe(panelMin);
});

test("on very wide screens the panel takes what the capped list leaves", () => {
  expect(clampWidth(null, 3600)).toBe(2160);
  expect(clampWidth(null, 1800)).toBe(756);
  expect(clampWidth(null, 3600, false)).toBe(1512);
});

test("a link replaces the panel issue, page changes keep it and a new scope clears it", () => {
  syncPanelIssue("ENG-1", "acme", "list");
  expect(panelIssue()).toBe("ENG-1");

  syncPanelIssue(null, "acme", "list");
  expect(panelIssue()).toBe("ENG-1");

  syncPanelIssue("ENG-2", "acme", "list");
  expect(panelIssue()).toBe("ENG-2");

  syncPanelIssue(null, "acme", "wiki");
  expect(panelIssue()).toBeNull();

  syncPanelIssue("ENG-3", "acme", "wiki");
  syncPanelIssue(null, "other", "wiki");
  expect(panelIssue()).toBeNull();
});
