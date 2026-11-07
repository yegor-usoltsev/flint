import { describe, expect, test } from "bun:test";

import { idleSave, saveStatus, trackSave } from "~/lib/save-status";
import type { SaveEvent, SaveTrack } from "~/lib/save-status";

const run = (events: SaveEvent<string>[]) => {
  let state: SaveTrack<string> = idleSave;

  for (const event of events) {
    state = trackSave(state, event);
  }

  return state;
};

describe("trackSave", () => {
  test("shows saving, then saved until it expires", () => {
    expect(saveStatus(run([{ type: "start" }]))).toBe("saving");
    expect(saveStatus(run([{ type: "start" }, { type: "succeed" }]))).toBe(
      "saved"
    );
    expect(
      saveStatus(
        run([{ type: "start" }, { type: "succeed" }, { type: "expire" }])
      )
    ).toBe("idle");
  });

  test("keeps saving while another save is in flight", () => {
    expect(
      saveStatus(
        run([{ type: "start" }, { type: "start" }, { type: "succeed" }])
      )
    ).toBe("saving");
  });

  test("keeps a failure and its retry over a parallel success", () => {
    const state = run([
      { type: "start" },
      { type: "start" },
      { run: "name", type: "fail" },
      { type: "succeed" },
    ]);

    expect(saveStatus(state)).toBe("failed");
    expect(state.failed).toBe("name");
  });

  test("clears a failure when the next save starts", () => {
    const state = run([
      { type: "start" },
      { run: "name", type: "fail" },
      { type: "start" },
      { type: "succeed" },
    ]);

    expect(saveStatus(state)).toBe("saved");
    expect(state.failed).toBeNull();
  });

  test("shows nothing for a rejected value", () => {
    expect(saveStatus(run([{ type: "start" }, { type: "reject" }]))).toBe(
      "idle"
    );
  });
});
