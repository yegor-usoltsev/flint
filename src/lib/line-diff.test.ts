import { describe, expect, test } from "bun:test";

import { changedLines, diff, wordDiff } from "~/lib/line-diff";

describe("changed lines", () => {
  test("marks only the lines each side changed", () => {
    const changed = changedLines("a\nb\nmine\nc", "a\nb\nc\ntheirs");

    expect([...changed.mine]).toEqual([2]);
    expect([...changed.theirs]).toEqual([3]);
  });

  test("marks nothing for equal texts", () => {
    const changed = changedLines("same\ntext", "same\ntext");

    expect(changed.mine.size + changed.theirs.size).toBe(0);
  });
});

describe("diff", () => {
  test("lists kept, removed and added lines in order", () => {
    expect(diff(["a", "b", "c"], ["a", "x", "c", "d"])).toEqual([
      { change: "same", text: "a" },
      { change: "removed", text: "b" },
      { change: "added", text: "x" },
      { change: "same", text: "c" },
      { change: "added", text: "d" },
    ]);
  });

  test("marks changed words inside a line", () => {
    expect(wordDiff("the quick fox", "the slow fox")).toEqual([
      { change: "same", text: "the " },
      { change: "removed", text: "quick" },
      { change: "added", text: "slow" },
      { change: "same", text: " fox" },
    ]);
  });
});
