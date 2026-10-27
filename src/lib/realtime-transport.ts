import { heartbeatMs, leaseMs, realtimeUrl } from "~/lib/realtime-shared";
import type {
  RealtimeMessage,
  RealtimeSubscription,
} from "~/lib/realtime-shared";

interface WorkerTimers {
  startup?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>;
}

export const subscribeRealtime = (
  slug: string,
  userId: string,
  receive: (message: RealtimeMessage) => void
) => {
  let stop: (() => void) | null = null;
  let direct = typeof SharedWorker === "undefined";
  let hidden = false;

  const connectDirect = () => {
    const controller = new AbortController();
    const source = new EventSource(realtimeUrl(slug, userId));
    let retry: ReturnType<typeof setTimeout> | undefined;

    source.addEventListener(
      "open",
      () => {
        receive({ type: "open" });
      },
      { signal: controller.signal }
    );

    source.addEventListener(
      "message",
      ({ data }: MessageEvent<string>) => {
        receive({ data, type: "message" });
      },
      { signal: controller.signal }
    );

    source.addEventListener(
      "error",
      () => {
        receive({ type: "error" });

        if (source.readyState === EventSource.CLOSED) {
          source.close();
          retry = setTimeout(() => {
            stop = connectDirect();
          }, 3000);
        }
      },
      { signal: controller.signal }
    );

    return () => {
      controller.abort();
      clearTimeout(retry);
      source.close();
    };
  };

  const connectShared = () => {
    const worker = new SharedWorker(
      new URL("realtime-worker.ts", import.meta.url),
      { type: "module" }
    );

    const controller = new AbortController();

    const timers: WorkerTimers = {};

    let lastReply = Date.now();
    let stopped = false;

    const post = (message: RealtimeSubscription) => {
      worker.port.postMessage(message, []);
    };

    const close = () => {
      stopped = true;
      clearTimeout(timers.startup);
      clearInterval(timers.heartbeat);
      controller.abort();
      post({ type: "unsubscribe" });
      worker.port.close();
    };

    const fallback = () => {
      if (stopped) {
        return;
      }

      close();
      direct = true;
      receive({ type: "error" });
      stop = connectDirect();
    };

    timers.startup = setTimeout(fallback, 5000);

    timers.heartbeat = setInterval(() => {
      if (Date.now() - lastReply >= leaseMs) {
        fallback();
      } else {
        post({ type: "ping" });
      }
    }, heartbeatMs);

    worker.addEventListener("error", fallback, { signal: controller.signal });
    worker.port.addEventListener("messageerror", fallback, {
      signal: controller.signal,
    });
    worker.port.addEventListener(
      "message",
      ({ data }: MessageEvent<RealtimeMessage>) => {
        lastReply = Date.now();
        clearTimeout(timers.startup);

        if (data.type === "unsupported") {
          fallback();
        } else if (data.type !== "pong") {
          receive(data);
        }
      },
      { signal: controller.signal }
    );

    worker.port.start();
    post({ slug, type: "subscribe", userId });

    return close;
  };

  const disconnect = () => {
    stop?.();
    stop = null;
  };

  const connect = () => {
    if (hidden || document.hidden || stop !== null) {
      return;
    }

    try {
      stop = direct ? connectDirect() : connectShared();
    } catch {
      direct = true;
      stop = connectDirect();
    }
  };

  const visibility = () => {
    if (document.hidden) {
      disconnect();
    } else {
      connect();
    }
  };

  const pagehide = () => {
    hidden = true;
    disconnect();
  };

  const pageshow = () => {
    hidden = false;
    connect();
  };

  connect();
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", pageshow);

  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("pageshow", pageshow);
    disconnect();
  };
};
