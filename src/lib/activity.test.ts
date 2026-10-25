import { describe, expect, test } from "bun:test";

import { activityFeed } from "~/lib/activity";
import type { Comment, IssueEvent, UserRef } from "~/lib/api-types";

const user = (id: string): UserRef => ({
  avatarUrl: "",
  displayName: id,
  id,
  username: id,
});

const alice = user("alice");
const bob = user("bob");

let sequence = 0;

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 9, 24, 12, 0) + minutes * 60_000).toISOString();

interface EventOptions {
  actor?: UserRef;
  from?: IssueEvent["fromValue"];
  to?: IssueEvent["toValue"];
  viaApi?: boolean;
}

const event = (
  kind: IssueEvent["kind"],
  minutes: number,
  { actor = alice, from = null, to = null, viaApi = false }: EventOptions = {}
): IssueEvent => {
  sequence += 1;

  return {
    actor,
    createdAt: at(minutes),
    fromValue: from,
    id: `e${sequence}`,
    kind,
    toValue: to,
    viaApi,
  };
};

const comment = (minutes: number): Comment => ({
  author: bob,
  body: "Hi",
  createdAt: at(minutes),
  editedAt: null,
  id: `c${minutes}`,
  issueId: "issue",
  version: 1,
  viaApi: false,
});

const changes = (events: IssueEvent[], comments: Comment[] = []) =>
  activityFeed(events, comments).map((item) =>
    item.type === "comment" ? "comment" : item.changes
  );

describe("activityFeed", () => {
  test("merges an actor's consecutive changes into one item", () => {
    expect(
      changes([
        event("assignee", 0, { to: "alice" }),
        event("priority", 1, { from: 0, to: 2 }),
        event("label_added", 2, { to: "bug" }),
        event("label_added", 3, { to: "ui" }),
      ])
    ).toEqual([
      [
        { from: null, kind: "assignee", to: "alice" },
        { from: 0, kind: "priority", to: 2 },
        { added: ["bug", "ui"], kind: "labels", removed: [] },
      ],
    ]);
  });

  test("drops a label added and removed again", () => {
    expect(
      changes([
        event("label_added", 0, { to: "bug" }),
        event("label_removed", 1, { from: "bug" }),
      ])
    ).toEqual([]);
  });

  test("drops a label removed and added again", () => {
    expect(
      changes([
        event("label_removed", 0, { from: "bug" }),
        event("label_added", 1, { to: "bug" }),
        event("label_added", 1, { to: "ui" }),
      ])
    ).toEqual([[{ added: ["ui"], kind: "labels", removed: [] }]]);
  });

  test("collapses consecutive status changes to first and last", () => {
    expect(
      changes([
        event("status", 0, { from: "todo", to: "doing" }),
        event("status", 1, { from: "doing", to: "review" }),
        event("status", 2, { from: "review", to: "done" }),
      ])
    ).toEqual([[{ from: "todo", kind: "status", to: "done" }]]);
  });

  test("drops a status change that returns to the start", () => {
    expect(
      changes([
        event("status", 0, { from: "todo", to: "doing" }),
        event("status", 1, { from: "doing", to: "todo" }),
      ])
    ).toEqual([]);
  });

  test("keeps an empty starting value across repeated changes", () => {
    expect(
      changes([
        event("assignee", 0, { from: null, to: "alice" }),
        event("assignee", 1, { from: "alice", to: "bob" }),
        event("assignee", 2, { from: "bob", to: "alice" }),
      ])
    ).toEqual([[{ from: null, kind: "assignee", to: "alice" }]]);
  });

  test("drops an assignment that returns to nobody", () => {
    expect(
      changes([
        event("assignee", 0, { from: null, to: "alice" }),
        event("assignee", 1, { from: "alice", to: null }),
      ])
    ).toEqual([]);
  });

  test("keeps the final value of repeated changes", () => {
    expect(
      changes([
        event("priority", 0, { from: 0, to: 1 }),
        event("priority", 1, { from: 1, to: 4 }),
        event("title", 2, { from: "A", to: "B" }),
        event("title", 3, { from: "B", to: "A" }),
        event("description", 4),
        event("description", 5),
      ])
    ).toEqual([
      [
        { from: 0, kind: "priority", to: 4 },
        { added: [], kind: "description", removed: [] },
      ],
    ]);
  });

  test("puts status changes on their own item in order of appearance", () => {
    const items = activityFeed(
      [
        event("status", 0, { from: "todo", to: "doing" }),
        event("assignee", 1, { from: null, to: "alice" }),
      ],
      []
    );

    expect(
      items.map((item) => (item.type === "event" ? item.changes : []))
    ).toEqual([
      [{ from: "todo", kind: "status", to: "doing" }],
      [{ from: null, kind: "assignee", to: "alice" }],
    ]);
    expect(
      new Set(items.map((item) => item.type === "event" && item.id)).size
    ).toBe(2);
  });

  test("cancels a delete followed by a restore", () => {
    expect(
      changes([event("deleted", 0), event("restored", 1), event("deleted", 2)])
    ).toEqual([[{ added: [], kind: "deleted", removed: [] }]]);
  });

  test("keeps creation on its own item", () => {
    expect(
      changes([event("created", 0), event("priority", 0, { from: 0, to: 1 })])
    ).toEqual([
      [{ added: [], kind: "created", removed: [] }],
      [{ from: 0, kind: "priority", to: 1 }],
    ]);
  });

  test("splits by actor, API use, time gap and comments", () => {
    expect(
      changes(
        [
          event("priority", 0, { from: 0, to: 1 }),
          event("priority", 1, { actor: bob, from: 1, to: 2 }),
          event("priority", 2, { actor: bob, from: 2, to: 3, viaApi: true }),
          event("priority", 30, { actor: bob, from: 3, to: 4, viaApi: true }),
          event("priority", 32, { actor: bob, from: 4, to: 1, viaApi: true }),
        ],
        [comment(31)]
      )
    ).toEqual([
      [{ from: 0, kind: "priority", to: 1 }],
      [{ from: 1, kind: "priority", to: 2 }],
      [{ from: 2, kind: "priority", to: 3 }],
      [{ from: 3, kind: "priority", to: 4 }],
      "comment",
      [{ from: 4, kind: "priority", to: 1 }],
    ]);
  });

  test("hides comment events and never mutates the input", () => {
    const events = [event("comment_created", 0), event("comment_deleted", 1)];
    const copy = structuredClone(events);

    expect(changes(events, [comment(0)])).toEqual(["comment"]);
    expect(events).toEqual(copy);
  });
});
