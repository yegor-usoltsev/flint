import { afterEach, beforeEach, expect, jest, spyOn, test } from "bun:test";
import { setImmediate as settle } from "node:timers/promises";

import {
  createRealtimeHub,
  heartbeatMs,
  hiddenStreamMs,
  leaseMs,
  retryDelay,
  stallMs,
} from "~/lib/realtime-shared";
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
  Source.behavior.blocked = false;
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
  jest.advanceTimersByTime(hiddenStreamMs - 1);
  tab.document.hidden = false;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  jest.advanceTimersByTime(hiddenStreamMs);
  expect(Source.instances).toHaveLength(1);
  expect(Source.instances[0]?.readyState).toBe(Source.OPEN);
  tab.document.hidden = true;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  jest.advanceTimersByTime(hiddenStreamMs);
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

test("working worker keeps hidden tabs subscribed without a heartbeat and releases them on cleanup", async () => {
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
  jest.advanceTimersByTime(leaseMs * 3);
  await settle();
  Source.instances[0]?.message("while hidden");
  await settle();
  expect(Source.instances).toHaveLength(1);
  expect(Source.instances[0]?.readyState).toBe(Source.OPEN);
  expect(tab.messages).toContainEqual({
    data: "while hidden",
    type: "message",
  });
  tab.document.hidden = false;
  tab.document.dispatchEvent(new Event("visibilitychange"));
  await settle();

  for (let beat = 0; beat < 4; beat += 1) {
    jest.advanceTimersByTime(heartbeatMs);
    // oxlint-disable-next-line no-await-in-loop -- Each heartbeat waits for the worker's reply.
    await settle();
  }

  expect(Source.instances).toHaveLength(1);
  expect(tab.messages.filter((item) => item.type === "open")).toHaveLength(1);
  tab.stop();
  await settle();
  expect(Source.instances[0]?.readyState).toBe(Source.CLOSED);
});

test("a hidden tab stays exempt from the sweep after asking to reconnect", async () => {
  const hidden = await subscribe();

  hidden.port.postMessage({ type: "hide" }, []);
  hidden.port.postMessage({ type: "reconnect" }, []);
  await settle();
  jest.advanceTimersByTime(leaseMs * 2);
  Source.instances.at(-1)?.message("later");
  await settle();
  expect(hidden.messages).toContainEqual({ data: "later", type: "message" });
});

test("a frozen tab releases the shared stream and rejoins on resume", async () => {
  const tab = client(Worker);

  await settle();
  Source.instances[0]?.open();
  await settle();
  tab.document.dispatchEvent(new Event("freeze"));
  await settle();
  expect(Source.instances[0]?.readyState).toBe(Source.CLOSED);
  tab.document.dispatchEvent(new Event("resume"));
  await settle();
  expect(Source.instances).toHaveLength(2);
});

test("a tab that starts hidden joins the shared stream at once", async () => {
  const document = Object.assign(new EventTarget(), { hidden: true });

  replace("document", document);
  replace("window", new EventTarget());
  replace("SharedWorker", Worker);
  cleanups.push(subscribeRealtime("acme", "alice", () => {}));
  await settle();
  expect(Source.instances).toHaveLength(1);
  jest.advanceTimersByTime(leaseMs * 2);
  await settle();
  expect(Source.instances[0]?.readyState).not.toBe(Source.CLOSED);
});

test("worker startup failure falls back once without leaking retry timers", () => {
  Worker.behavior.mode = "throw";
  client(Worker);
  expect(Source.instances).toHaveLength(1);
});

test("a hidden tab whose worker fails to start waits until shown to connect", () => {
  Worker.behavior.mode = "throw";

  const document = Object.assign(new EventTarget(), { hidden: true });

  replace("document", document);
  replace("window", new EventTarget());
  replace("SharedWorker", Worker);
  cleanups.push(subscribeRealtime("acme", "alice", () => {}));
  expect(Source.instances).toHaveLength(0);
  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
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

test("a stream that goes silent while open reconnects in the worker and the direct fallback", async () => {
  const shared = await subscribe();

  Source.instances[0]?.open();
  Source.instances[0]?.dispatchEvent(new Event("ping"));
  jest.advanceTimersByTime(stallMs - 1000);
  Source.instances[0]?.dispatchEvent(new Event("ping"));
  shared.port.postMessage({ type: "ping" }, []);
  await settle();
  jest.advanceTimersByTime(stallMs - 1000);
  expect(Source.instances).toHaveLength(1);
  jest.advanceTimersByTime(5000);
  await settle();
  expect(Source.instances[0]?.readyState).toBe(Source.CLOSED);
  expect(Source.instances).toHaveLength(2);
  expect(shared.messages).toContainEqual({ type: "error" });
  shared.port.postMessage({ type: "unsubscribe" }, []);
  await settle();

  const tab = client(undefined);

  Source.instances[2]?.open();
  Source.instances[2]?.dispatchEvent(new Event("ping"));
  jest.advanceTimersByTime(stallMs * 2);
  expect(Source.instances[2]?.readyState).toBe(Source.CLOSED);
  expect(Source.instances).toHaveLength(4);
  expect(tab.messages).toEqual([
    { type: "connecting" },
    { type: "open" },
    { type: "error" },
  ]);
});

test("a stream from a server that never sends named pings is not treated as stalled", () => {
  client(undefined);
  Source.instances[0]?.open();
  jest.advanceTimersByTime(stallMs * 3);
  expect(Source.instances).toHaveLength(1);
});

const failAfter = (wait: number) => {
  Source.instances.at(-1)?.fail();
  const count = Source.instances.length;

  jest.advanceTimersByTime(wait - 1);
  expect(Source.instances).toHaveLength(count);
  jest.advanceTimersByTime(1);
  expect(Source.instances).toHaveLength(count + 1);
};

test("reconnects back off from 1 s to 30 s with jitter and reset once open", () => {
  expect(
    [0, 1, 2, 3, 4, 5, 6].map((attempt) => retryDelay(attempt, 0))
  ).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  expect(retryDelay(0, 1)).toBe(750);
  expect(retryDelay(9, 0.5)).toBe(26_250);

  const random = spyOn(Math, "random").mockReturnValue(0);

  cleanups.push(() => {
    random.mockRestore();
  });
  client(undefined);

  failAfter(1000);
  failAfter(2000);
  failAfter(4000);
  Source.instances.at(-1)?.open();
  failAfter(1000);
});

test("going online retries a waiting stream at once in the worker and the direct fallback", async () => {
  const random = spyOn(Math, "random").mockReturnValue(0);

  cleanups.push(() => {
    random.mockRestore();
  });

  const tab = client(Worker);

  await settle();
  Source.instances[0]?.fail();
  await settle();
  jest.advanceTimersByTime(1000);
  Source.instances[1]?.fail();
  await settle();
  expect(Source.instances).toHaveLength(2);
  tab.window.dispatchEvent(new Event("online"));
  await settle();
  expect(Source.instances).toHaveLength(3);
  tab.window.dispatchEvent(new Event("online"));
  await settle();
  expect(Source.instances).toHaveLength(3);
  Source.instances[2]?.open();
  tab.window.dispatchEvent(new Event("online"));
  await settle();
  expect(Source.instances[2]?.readyState).toBe(Source.CLOSED);
  expect(Source.instances).toHaveLength(4);
  tab.stop();
  await settle();

  const direct = client(undefined);

  Source.instances[4]?.fail();
  expect(Source.instances).toHaveLength(5);
  direct.window.dispatchEvent(new Event("online"));
  expect(Source.instances).toHaveLength(6);
  direct.window.dispatchEvent(new Event("online"));
  expect(Source.instances).toHaveLength(6);
  Source.instances[5]?.open();
  direct.window.dispatchEvent(new Event("online"));
  expect(Source.instances[5]?.readyState).toBe(Source.CLOSED);
  expect(Source.instances).toHaveLength(7);
  expect(direct.messages).toEqual([
    { type: "connecting" },
    { type: "error" },
    { type: "open" },
  ]);
});

test("forced retries keep backing off until a stream opens", () => {
  const random = spyOn(Math, "random").mockReturnValue(0);

  cleanups.push(() => {
    random.mockRestore();
  });

  const tab = client(undefined);

  failAfter(1000);
  tab.window.dispatchEvent(new Event("online"));
  failAfter(2000);
  failAfter(4000);
});

test("tabs joining a stream the browser cannot open learn it is unsupported", async () => {
  Source.behavior.blocked = true;

  const a = await subscribe();
  const b = await subscribe();

  expect(a.messages).toContainEqual({ type: "unsupported" });
  expect(b.messages).toContainEqual({ type: "unsupported" });
});

test("a tab joining a stream that waits to retry reconnects it at once", async () => {
  await subscribe();
  Source.instances[0]?.fail();
  await settle();
  expect(Source.instances).toHaveLength(1);
  await subscribe();
  expect(Source.instances).toHaveLength(2);
});
