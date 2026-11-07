export type RealtimeMessage =
  | { type: "connecting" | "error" | "open" }
  | { type: "pong" | "unsupported" }
  | { type: "message"; data: string };

export type RealtimeSubscription =
  | { type: "subscribe"; slug: string; userId: string }
  | { type: "ping" | "reconnect" | "unsubscribe" };

export const realtimeUrl = (slug: string, userId: string) =>
  `/api/v1/workspaces/${encodeURIComponent(slug)}/stream?userId=${encodeURIComponent(userId)}`;

export const heartbeatMs = 10_000;
export const leaseMs = 30_000;
export const stallMs = 15_000;

// Servers before named pings send only comments, which EventSource hides, so the watchdog waits for the first ping.
export const watchStall = (source: EventSource, stalled: () => void) => {
  let last: number | null = null;

  const alive = () => {
    last = Date.now();
  };

  source.addEventListener("ping", alive);

  const timer = setInterval(() => {
    if (source.readyState === EventSource.CLOSED) {
      clearInterval(timer);
    } else if (
      source.readyState === EventSource.OPEN &&
      last !== null &&
      Date.now() - last >= stallMs
    ) {
      clearInterval(timer);
      source.close();
      stalled();
    }
  }, stallMs / 3);
};

export const retryBaseMs = 1000;
export const retryMaxMs = 30_000;

export const retryDelay = (
  attempt: number,
  // oxlint-disable-next-line sonarjs/pseudo-random -- Jitter only spreads reconnects; it guards nothing.
  random = Math.random()
) =>
  Math.round(
    Math.min(retryMaxMs, retryBaseMs * 2 ** attempt) * (1 - random / 4)
  );

export interface RealtimeStream {
  close: () => void;
  isOpen: () => boolean;
  reconnect: () => void;
  retryNow: () => void;
}

export const openStream = (
  url: string,
  emit: (message: RealtimeMessage) => void
): RealtimeStream => {
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;
  let forced = false;

  const connect = () => {
    retry = null;

    let current: EventSource;

    try {
      current = new EventSource(url);
    } catch {
      closed = true;
      emit({ type: "unsupported" });

      return;
    }

    const lost = () => {
      if (source !== current || closed) {
        return;
      }

      current.close();
      source = null;
      forced = false;
      emit({ type: "error" });
      retry = setTimeout(connect, retryDelay(attempt));
      attempt += 1;
    };

    source = current;
    watchStall(current, lost);
    current.addEventListener("open", () => {
      attempt = 0;
      forced = false;
      emit({ type: "open" });
    });
    current.addEventListener("message", ({ data }: MessageEvent<string>) => {
      emit({ data, type: "message" });
    });
    current.addEventListener("error", lost);
  };

  connect();

  return {
    close: () => {
      closed = true;

      if (retry !== null) {
        clearTimeout(retry);
      }

      source?.close();
      source = null;
    },
    isOpen: () => source?.readyState === EventSource.OPEN,
    reconnect: () => {
      if (closed || (forced && source?.readyState === EventSource.CONNECTING)) {
        return;
      }

      if (retry !== null) {
        clearTimeout(retry);
      }

      source?.close();
      source = null;
      forced = true;
      connect();
    },
    retryNow: () => {
      if (!closed && retry !== null) {
        clearTimeout(retry);
        connect();
      }
    },
  };
};

interface Stream {
  handle?: RealtimeStream;
  ports: Set<MessagePort>;
  url: string;
}

export const createRealtimeHub = () => {
  const streams = new Map<string, Stream>();
  const ports = new Map<MessagePort, { at: number; stream?: Stream }>();

  const detach = (port: MessagePort) => {
    const stream = ports.get(port)?.stream;

    ports.delete(port);
    port.close();

    if (stream === undefined) {
      return;
    }

    stream.ports.delete(port);

    if (stream.ports.size === 0) {
      stream.handle?.close();

      if (streams.get(stream.url) === stream) {
        streams.delete(stream.url);
      }
    }
  };

  const send = (stream: Stream, message: RealtimeMessage) => {
    for (const port of stream.ports) {
      port.postMessage(message, []);
    }
  };

  const sweep = setInterval(() => {
    for (const [port, { at }] of ports) {
      if (Date.now() - at >= leaseMs) {
        detach(port);
      }
    }
  }, heartbeatMs);

  const attach = (port: MessagePort) => {
    ports.set(port, { at: Date.now() });
    port.addEventListener(
      "message",
      ({ data }: MessageEvent<RealtimeSubscription>) => {
        const subscriber = ports.get(port);

        if (subscriber === undefined) {
          return;
        }

        subscriber.at = Date.now();

        if (data.type === "unsubscribe") {
          detach(port);
        } else if (data.type === "reconnect") {
          subscriber.stream?.handle?.reconnect();
        } else if (data.type === "ping") {
          port.postMessage({ type: "pong" } satisfies RealtimeMessage);
        } else if (
          data.type === "subscribe" &&
          subscriber.stream === undefined
        ) {
          const url = realtimeUrl(data.slug, data.userId);

          const stream = streams.get(url) ?? {
            ports: new Set<MessagePort>(),
            url,
          };

          subscriber.stream = stream;
          stream.ports.add(port);
          port.postMessage({ type: "pong" } satisfies RealtimeMessage);

          if (!streams.has(url)) {
            streams.set(url, stream);
            stream.handle = openStream(url, (message) => {
              if (message.type === "unsupported") {
                streams.delete(url);
              }

              send(stream, message);
            });
          } else if (stream.handle?.isOpen() === true) {
            port.postMessage({ type: "open" } satisfies RealtimeMessage);
          } else {
            stream.handle?.retryNow();
          }
        }
      }
    );

    port.start();
  };

  return {
    attach,
    close: () => {
      clearInterval(sweep);

      for (const port of ports.keys()) {
        detach(port);
      }
    },
  };
};
