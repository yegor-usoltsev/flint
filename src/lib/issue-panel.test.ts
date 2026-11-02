import { expect, test } from "bun:test";

import { clampWidth, listMin, panelMin } from "~/lib/issue-panel";

test("the panel width stays between its minimum and what leaves the list its minimum", () => {
  expect(clampWidth(null, 1400)).toBe(588);
  expect(clampWidth(100, 1400)).toBe(panelMin);
  expect(clampWidth(5000, 1400)).toBe(1400 - listMin);
  expect(clampWidth(5000, 2400)).toBe(1560);
  expect(clampWidth(600, panelMin + listMin)).toBe(panelMin);
});
