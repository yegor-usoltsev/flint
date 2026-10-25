import { describe, expect, test } from "bun:test";

import { headingsOf } from "~/lib/wiki-headings";

describe("wiki headings", () => {
  test("lists headings outside code fences", () => {
    expect(
      headingsOf(
        "# One\n\n```\n# Not a heading\n```\n\n## **Two**\n\n## Two\n\nSetext\n===\n\n#### Deep"
      )
    ).toEqual([
      { id: "One#1", level: 1, text: "One" },
      { id: "Two#1", level: 2, text: "Two" },
      { id: "Two#2", level: 2, text: "Two" },
      { id: "Setext#1", level: 1, text: "Setext" },
    ]);
  });
});
