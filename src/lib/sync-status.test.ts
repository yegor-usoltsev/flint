import { afterEach, beforeEach, expect, jest, test } from "bun:test";

import { connectionState } from "~/lib/realtime";
import { createSyncStatus, fadeMs } from "~/lib/sync-status";

let status: ReturnType<typeof createSyncStatus>;

beforeEach(() => {
  jest.useFakeTimers();
  status = createSyncStatus();
});

afterEach(() => {
  status.dispose();
  jest.useRealTimers();
});

test("connection state follows the stream and the browser's network", () => {
  expect(connectionState(true, true)).toBe("live");
  expect(connectionState(true, false)).toBe("offline");
  expect(connectionState(false, true)).toBe("connecting");
  expect(connectionState(false, false)).toBe("offline");
});

test("nothing shows while live or during short blips", () => {
  status.update({ connection: "live", pending: 0 });
  expect(status.get()).toBeNull();
  status.update({ connection: "connecting", pending: 0 });
  jest.advanceTimersByTime(2999);
  status.update({ connection: "live", pending: 0 });
  jest.advanceTimersByTime(10_000);
  expect(status.get()).toBeNull();
});

test("a lost connection shows after 3 s, then Synced for 2 s before fading", () => {
  status.update({ connection: "connecting", pending: 0 });
  jest.advanceTimersByTime(2999);
  expect(status.get()).toBeNull();
  jest.advanceTimersByTime(1);
  expect(status.get()).toEqual({ leaving: false, pill: "reconnecting" });
  status.update({ connection: "offline", pending: 0 });
  expect(status.get()?.pill).toBe("offline");
  status.update({ connection: "connecting", pending: 0 });
  expect(status.get()?.pill).toBe("reconnecting");
  status.update({ connection: "live", pending: 0 });
  expect(status.get()).toEqual({ leaving: false, pill: "synced" });
  jest.advanceTimersByTime(2000);
  expect(status.get()).toEqual({ leaving: true, pill: "synced" });
  jest.advanceTimersByTime(fadeMs);
  expect(status.get()).toBeNull();
});

test("offline at load shows the offline copy after 3 s", () => {
  status.update({ connection: "offline", pending: 0 });
  jest.advanceTimersByTime(3000);
  expect(status.get()?.pill).toBe("offline");
});

test("issue writes waiting over 1 s show Saving until the queue drains, without claiming success", () => {
  status.update({ connection: "live", pending: 1 });
  jest.advanceTimersByTime(500);
  status.update({ connection: "live", pending: 0 });
  jest.advanceTimersByTime(5000);
  expect(status.get()).toBeNull();
  status.update({ connection: "live", pending: 2 });
  jest.advanceTimersByTime(1000);
  expect(status.get()?.pill).toBe("saving");
  status.update({ connection: "live", pending: 0 });
  expect(status.get()).toEqual({ leaving: true, pill: "saving" });
  jest.advanceTimersByTime(fadeMs);
  expect(status.get()).toBeNull();
});

test("a lost connection outranks saving, and a pill shown again stops fading", () => {
  status.update({ connection: "connecting", pending: 1 });
  jest.advanceTimersByTime(3000);
  expect(status.get()?.pill).toBe("reconnecting");
  status.update({ connection: "live", pending: 1 });
  expect(status.get()?.pill).toBe("saving");
  status.update({ connection: "live", pending: 0 });
  expect(status.get()).toEqual({ leaving: false, pill: "synced" });
  jest.advanceTimersByTime(2000);
  expect(status.get()?.leaving).toBe(true);
  status.update({ connection: "live", pending: 1 });
  jest.advanceTimersByTime(1000);
  expect(status.get()).toEqual({ leaving: false, pill: "saving" });
  jest.advanceTimersByTime(fadeMs);
  expect(status.get()?.pill).toBe("saving");
});
