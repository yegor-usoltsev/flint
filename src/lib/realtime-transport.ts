import {
  heartbeatMs,
  hiddenStreamMs,
  leaseMs,
  openStream,
  realtimeUrl,
} from "~/lib/realtime-shared";
import type {
  RealtimeMessage,
  RealtimeSubscription,
} from "~/lib/realtime-shared";

interface Link {
  close: () => void;
  reconnect: () => void;
  shown?: (visible: boolean) => void;
}

interface WorkerTimers {
  startup?: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>;
}

export const subscribeRealtime = (
  slug: string,
  userId: string,
  receive: (message: RealtimeMessage) => void
) => {
  let link: Link | null = null;
  let direct = typeof SharedWorker === "undefined";
  let hidden = false;
  let away: ReturnType<typeof setTimeout> | undefined;

  const connectDirect = (): Link => {
    const stream = openStream(realtimeUrl(slug, userId), receive);

    return { close: stream.close, reconnect: stream.reconnect };
  };

  const connectShared = (): Link => {
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
      link = document.hidden ? null : connectDirect();
    };

    const beat = () => {
      timers.heartbeat = setInterval(() => {
        if (Date.now() - lastReply >= leaseMs) {
          fallback();
        } else {
          post({ type: "ping" });
        }
      }, heartbeatMs);
    };

    timers.startup = setTimeout(fallback, 5000);

    if (!document.hidden) {
      beat();
    }

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

    if (document.hidden) {
      post({ type: "hide" });
    }

    return {
      close,
      reconnect: () => {
        if (!stopped) {
          post({ type: "reconnect" });
        }
      },
      shown: (visible) => {
        clearInterval(timers.heartbeat);

        if (stopped) {
          return;
        }

        lastReply = Date.now();
        post({ type: visible ? "ping" : "hide" });

        if (visible) {
          beat();
        }
      },
    };
  };

  const disconnect = () => {
    link?.close();
    link = null;
  };

  const connect = () => {
    if (hidden || (direct && document.hidden) || link !== null) {
      return;
    }

    receive({ type: "connecting" });

    try {
      link = direct ? connectDirect() : connectShared();
    } catch {
      direct = true;
      link = connectDirect();
    }
  };

  const visibility = () => {
    clearTimeout(away);

    if (link?.shown !== undefined) {
      link.shown(!document.hidden);
    } else if (document.hidden) {
      away = setTimeout(disconnect, hiddenStreamMs);
    } else {
      connect();
    }
  };

  const online = () => {
    link?.reconnect();
  };

  const pagehide = () => {
    hidden = true;
    clearTimeout(away);
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
  window.addEventListener("online", online);

  return () => {
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("pageshow", pageshow);
    clearTimeout(away);
    disconnect();
  };
};
