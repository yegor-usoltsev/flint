import { describe, expect, test } from "bun:test";

import { followsEnd, seenIds } from "~/lib/held-comments";
import type { Reader } from "~/lib/held-comments";

const comment = (id: string, author = "bob") => ({
  author: { id: author },
  id,
});

const known = new Set(["c1"]);
const comments = [comment("c1"), comment("c2")];
const idle: Reader = { draft: "", endInView: true, focused: false };

const seen = (reader: Partial<Reader>, me = "alice", list = comments) => [
  ...seenIds({
    comments: list,
    known,
    me,
    reader: () => ({ ...idle, ...reader }),
  }),
];

describe("seenIds", () => {
  test("shows a teammate's comment at once while the reader is idle at the end", () => {
    expect(seen({})).toEqual(["c1", "c2"]);
  });

  test("holds it while the composer has focus", () => {
    expect(seen({ focused: true })).toEqual(["c1"]);
  });

  test("holds it while the composer has a draft", () => {
    expect(seen({ draft: "Half a thought" })).toEqual(["c1"]);
    expect(seen({ draft: "  \n" })).toEqual(["c1", "c2"]);
  });

  test("holds it while the end of the timeline is scrolled out of view", () => {
    expect(seen({ endInView: false })).toEqual(["c1"]);
  });

  test("releases a held comment once the end of the timeline comes into view", () => {
    const held = new Set(seen({ endInView: false }));

    expect([
      ...seenIds({ comments, known: held, me: "alice", reader: () => idle }),
    ]).toEqual(["c1", "c2"]);
  });

  test("releases a held comment once the draft is cleared and the composer blurs", () => {
    const held = new Set(seen({ draft: "Half a thought", focused: true }));

    const after = (reader: Partial<Reader>) => [
      ...seenIds({
        comments,
        known: held,
        me: "alice",
        reader: () => ({ ...idle, ...reader }),
      }),
    ];

    expect(after({ focused: true })).toEqual(["c1"]);
    expect(after({})).toEqual(["c1", "c2"]);
  });

  test("always shows the reader's own comments", () => {
    expect(seen({ focused: true }, "bob")).toEqual(["c1", "c2"]);
  });

  test("shows everything on first load", () => {
    expect([
      ...seenIds({
        comments,
        known: null,
        me: "alice",
        reader: () => ({ ...idle, focused: true }),
      }),
    ]).toEqual(["c1", "c2"]);
  });
});

describe("followsEnd", () => {
  test("keeps a reader within 48 px of the bottom pinned to it", () => {
    expect(followsEnd(0, idle)).toBe(true);
    expect(followsEnd(48, idle)).toBe(true);
    expect(followsEnd(49, idle)).toBe(false);
  });

  test("never pins while the reader writes or reads mid-thread", () => {
    expect(followsEnd(0, { ...idle, focused: true })).toBe(false);
    expect(followsEnd(0, { ...idle, draft: "Half a thought" })).toBe(false);
    expect(followsEnd(0, { ...idle, endInView: false })).toBe(false);
  });
});
