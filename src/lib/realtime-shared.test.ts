import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { setImmediate as settle } from "node:timers/promises";

import { createRealtimeHub, leaseMs } from "~/lib/realtime-shared";
import type { RealtimeMessage } from "~/lib/realtime-shared";
import { subscribeRealtime } from "~/lib/realtime-transport";

import { Source } from "../../test/realtime";

type BrowserStub = EventTarget | { prototype: EventTarget } | undefined;

const descriptors = new Map<string, PropertyDescriptor | undefined>();

const replace = (name: string, value: BrowserStub) => {
  if (!descriptors.has(name)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  Object.defineProperty(globalThis, name, { configurable: true, value });
};

let hub: ReturnType<typeof createRealtimeHub>;
const cleanups: (() => void)[] = [];

class Worker extends EventTarget {
  static readonly behavior = { mode: "working" };
  port: MessagePort;

  constructor() {
    super();

    if (Worker.behavior.mode === "throw") {
      throw new Error("blocked");
    }

    const { port1, port2 } = new MessageChannel();

    this.port = port1;

    if (Worker.behavior.mode === "working") {
      hub.attach(port2);
    } else {
      cleanups.push(() => {
        port2.close();
      });
    }
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  Source.instances.length = 0;
  Worker.behavior.mode = "working";
  replace("EventSource", Source);
  hub = createRealtimeHub();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  hub.close();
  jest.useRealTimers();

  for (const [name, descriptor] of descriptors) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }

  descriptors.clear();
});

const subscribe = async (userId = "alice", slug = "acme") => {
  const { port1, port2 } = new MessageChannel();
  const messages: RealtimeMessage[] = [];

  port1.addEventListener(
    "message",
    ({ data }: MessageEvent<RealtimeMessage>) => {
      messages.push(data);
    }
  );
  port1.start();
  hub.attach(port2);
  port1.postMessage({ slug, type: "subscribe", userId });
  cleanups.push(() => {
    port1.close();
  });
  await settle();

  return { messages, port: port1 };
};

test("tabs share one stream, catch up on joining, and receive only their namespace", async () => {
  const a = await subscribe();
  const [source] = Source.instances;

  source?.open();
  await settle();
  const b = await subscribe();

  expect(Source.instances).toHaveLength(1);
  expect(a.messages).toContainEqual({ type: "open" });
  expect(b.messages).toContainEqual({ type: "open" });
  const bob = await subscribe("bob");
  const other = await subscribe("alice", "other");

  expect(Source.instances.map((item) => item.url)).toEqual([
    "/api/v1/workspaces/acme/stream?userId=alice",
    "/api/v1/workspaces/acme/stream?userId=bob",
    "/api/v1/workspaces/other/stream?userId=alice",
  ]);
  source?.message("change");
  await settle();
  expect(a.messages).toContainEqual({ data: "change", type: "message" });
  expect(b.messages).toContainEqual({ data: "change", type: "message" });
  expect(bob.messages).not.toContainEqual({ data: "change", type: "message" });
  expect(other.messages).not.toContainEqual({
    data: "change",
    type: "message",
  });
  a.port.postMessage({ type: "unsubscribe" }, []);
  await settle();
  source?.message("later");
  await settle();
  expect(a.messages).not.toContainEqual({ data: "later", type: "message" });
  expect(b.messages).toContainEqual({ data: "later", type: "message" });
  b.port.postMessage({ type: "unsubscribe" }, []);
  await settle();
  expect(source?.readyState).toBe(Source.CLOSED);
});

test("all connecting tabs catch up when the stream opens or reconnects", async () => {
  const a = await subscribe();
  const b = await subscribe();

  expect(b.messages).toEqual([{ type: "pong" }]);
  Source.instances[0]?.open();
  await settle();
  expect(a.messages).toContainEqual({ type: "open" });
  expect(b.messages).toContainEqual({ type: "open" });
  Source.instances[0]?.fail();
  await settle();
  expect(a.messages).toContainEqual({ type: "error" });
  jest.advanceTimersByTime(3000);
  Source.instances[1]?.open();
  await settle();
  expect(a.messages.filter((item) => item.type === "open")).toHaveLength(2);
  expect(b.messages.filter((item) => item.type === "open")).toHaveLength(2);
  a.port.postMessage({ type: "unsubscribe" }, []);
  b.port.postMessage({ type: "unsubscribe" }, []);
  await settle();
  jest.advanceTimersByTime(3000);
  expect(Source.instances).toHaveLength(2);
});

test("expired ports stop receiving events without disconnecting live subscribers", async () => {
  const expired = await subscribe();
  const live = await subscribe();
  const [source] = Source.instances;

  jest.advanceTimersByTime(20_000);
  live.port.postMessage({ type: "ping" }, []);
  await settle();
  jest.advanceTimersByTime(10_000);
  source?.message("after expiry");
  await settle();
  expect(expired.messages).not.toContainEqual({
    data: "after expiry",
    type: "message",
  });
  expect(live.messages).toContainEqual({
    data: "after expiry",
    type: "message",
  });
  expect(source?.readyState).not.toBe(Source.CLOSED);
  jest.advanceTimersByTime(leaseMs);
  expect(source?.readyState).toBe(Source.CLOSED);
});

const client = (workerClass: BrowserStub) => {
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = new EventTarget();
  const messages: RealtimeMessage[] = [];

  replace("document", document);
  replace("window", window);
  replace("SharedWorker", workerClass);

  const stop = subscribeRealtime("acme", "alice", (message) => {
    messages.push(message);
  });

  cleanups.push(stop);

  return { document, messages, stop, window };
};

test("direct fallback handles missing workers, hidden tabs and bfcache", () => {
  const tab = client(undefined);

  expect(Source.instances).toHaveLength(1);
  Source.instances[0]?.open();
  expect(tab.messages).toContainEqual({ type: "open" });
  tab.document.hidden = true;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  expect(Source.instances[0]?.readyState).toBe(Source.CLOSED);
  tab.document.hidden = false;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  expect(Source.instances).toHaveLength(2);
  tab.window.dispatchEvent(new Event("pagehide"));
  expect(Source.instances[1]?.readyState).toBe(Source.CLOSED);
  tab.window.dispatchEvent(new Event("pageshow"));
  expect(Source.instances).toHaveLength(3);
  Source.instances[2]?.fail();
  tab.stop();
  jest.advanceTimersByTime(3000);
  expect(Source.instances).toHaveLength(3);
});

test("working worker shares events and releases its port on hidden and cleanup", async () => {
  const tab = client(Worker);

  await settle();
  expect(Source.instances).toHaveLength(1);
  Source.instances[0]?.open();
  await settle();
  expect(tab.messages).toContainEqual({ type: "open" });
  jest.advanceTimersByTime(10_000);
  await settle();
  tab.document.hidden = true;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  expect(Source.instances[0]?.readyState).toBe(Source.CLOSED);
  tab.document.hidden = false;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  expect(Source.instances).toHaveLength(2);
  tab.stop();
  await settle();
  expect(Source.instances[1]?.readyState).toBe(Source.CLOSED);
});

test("worker startup failure falls back once without leaking retry timers", () => {
  Worker.behavior.mode = "throw";
  client(Worker);
  expect(Source.instances).toHaveLength(1);
});

test("a silent worker falls back after startup timeout", () => {
  Worker.behavior.mode = "silent";
  client(Worker);
  expect(Source.instances).toHaveLength(0);
  jest.advanceTimersByTime(5000);
  expect(Source.instances).toHaveLength(1);
  jest.advanceTimersByTime(leaseMs);
  expect(Source.instances).toHaveLength(1);
});

test("a worker that dies silently falls back after its heartbeat expires", async () => {
  client(Worker);
  await settle();
  expect(Source.instances).toHaveLength(1);
  hub.close();
  jest.advanceTimersByTime(leaseMs);
  expect(Source.instances).toHaveLength(2);
});
