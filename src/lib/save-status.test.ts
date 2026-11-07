import { describe, expect, test } from "bun:test";

import { idleSave, saveStatus, trackSave } from "~/lib/save-status";
import type { SaveEvent, SaveTrack } from "~/lib/save-status";

const retries: string[] = [];

const retry = () => {
  retries.push("name");
};

const run = (events: SaveEvent[]) => {
  let state: SaveTrack = idleSave;

  for (const event of events) {
    state = trackSave(state, event);
  }

  return state;
};

describe("trackSave", () => {
  test("shows saving, then saved until it expires", () => {
    expect(saveStatus(run([{ key: "name", type: "start" }]))).toBe("saving");

    const saved = run([
      { key: "name", type: "start" },
      { key: "name", type: "succeed" },
    ]);

    expect(saveStatus(saved)).toBe("saved");
    expect(saveStatus(trackSave(saved, { type: "expire" }))).toBe("idle");
  });

  test("keeps saving while another save is in flight", () => {
    expect(
      saveStatus(
        run([
          { key: "name", type: "start" },
          { key: "color", type: "start" },
          { key: "color", type: "succeed" },
        ])
      )
    ).toBe("saving");
  });

  test("keeps a failure over a later save of another field", () => {
    const state = run([
      { key: "name", type: "start" },
      { key: "name", retry, type: "fail" },
      { key: "color", type: "start" },
      { key: "color", type: "succeed" },
    ]);

    expect(saveStatus(state)).toBe("failed");
    state.failed["name"]?.();
    expect(retries).toEqual(["name"]);
  });

  test("clears a failure when the same field saves again", () => {
    const state = run([
      { key: "name", type: "start" },
      { key: "name", retry, type: "fail" },
      { key: "name", type: "start" },
      { key: "name", type: "succeed" },
    ]);

    expect(saveStatus(state)).toBe("saved");
  });

  test("shows nothing for a rejected value", () => {
    expect(
      saveStatus(
        run([
          { key: "name", type: "start" },
          { key: "name", type: "reject" },
        ])
      )
    ).toBe("idle");
  });
});
