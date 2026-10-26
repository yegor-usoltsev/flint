export type RealtimeMessage =
  | { type: "open" | "error" }
  | { type: "pong" | "unsupported" }
  | { type: "message"; data: string };

export type RealtimeSubscription =
  | { type: "subscribe"; slug: string; userId: string }
  | { type: "ping" | "unsubscribe" };

export const realtimeUrl = (slug: string, userId: string) =>
  `/api/v1/workspaces/${encodeURIComponent(slug)}/stream?userId=${encodeURIComponent(userId)}`;

export const heartbeatMs = 10_000;
export const leaseMs = 30_000;

interface Stream {
  ports: Set<MessagePort>;
  source: EventSource | null;
  retry?: ReturnType<typeof setTimeout>;
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
      clearTimeout(stream.retry);
      stream.source?.close();
      streams.delete(stream.url);
    }
  };

  const send = (stream: Stream, message: RealtimeMessage) => {
    for (const port of stream.ports) {
      port.postMessage(message, []);
    }
  };

  const connect = (stream: Stream) => {
    let source: EventSource;

    try {
      source = new EventSource(stream.url);
    } catch {
      send(stream, { type: "unsupported" });

      return;
    }

    stream.source = source;
    source.addEventListener("open", () => {
      send(stream, { type: "open" });
    });

    source.addEventListener("message", (message: MessageEvent<string>) => {
      send(stream, { data: message.data, type: "message" });
    });

    source.addEventListener("error", () => {
      send(stream, { type: "error" });

      if (source.readyState === EventSource.CLOSED && stream.ports.size > 0) {
        source.close();
        stream.source = null;
        stream.retry = setTimeout(() => {
          connect(stream);
        }, 3000);
      }
    });
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
        } else if (data.type === "ping") {
          port.postMessage({ type: "pong" } satisfies RealtimeMessage);
        } else if (
          data.type === "subscribe" &&
          subscriber.stream === undefined
        ) {
          const url = realtimeUrl(data.slug, data.userId);

          const stream = streams.get(url) ?? {
            ports: new Set<MessagePort>(),
            source: null,
            url,
          };

          subscriber.stream = stream;
          stream.ports.add(port);
          port.postMessage({ type: "pong" } satisfies RealtimeMessage);

          if (!streams.has(url)) {
            streams.set(url, stream);
            connect(stream);
          } else if (stream.source?.readyState === EventSource.OPEN) {
            port.postMessage({ type: "open" } satisfies RealtimeMessage);
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
