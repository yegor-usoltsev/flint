import { expect, test } from "bun:test";

import { rangeLabel, visibleRange } from "~/lib/board-range";

const ids = ["a", "b", "c", "d", "e", "f"];

test("the range spans the first and last fully visible columns", () => {
  expect(visibleRange(ids, new Set(["a", "b", "c"]))).toEqual({
    count: 6,
    first: 1,
    last: 3,
  });
  expect(visibleRange(ids, new Set(["f", "d", "e"]))).toEqual({
    count: 6,
    first: 4,
    last: 6,
  });
  expect(visibleRange(ids, new Set())).toBeNull();
});

test("the label reads like 1–3 of 6, or a single position", () => {
  expect(rangeLabel({ count: 6, first: 1, last: 3 })).toBe("1–3 of 6");
  expect(rangeLabel({ count: 6, first: 4, last: 4 })).toBe("4 of 6");
});
