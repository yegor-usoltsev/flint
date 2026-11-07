import type { RealtimeEvent } from "~/lib/api-types";
import { notFound, requireWorkspace } from "~/server/access.server";
import { ApiError, resolveActor } from "~/server/api.server";
import type { Actor } from "~/server/api.server";
import { env } from "~/server/env.server";
import { perKey } from "~/server/limits.server";

interface Listener {
  close: () => void;
  send: (chunk: Uint8Array) => void;
  stop: () => void;
  userId: string;
}

const pingMs = 5000;
const pingsPerCheck = 6;
const listeners = new Map<string, Set<Listener>>();
const streams = perKey(() => env.STREAMS_PER_USER);
const encoder = new TextEncoder();
const pingChunk = encoder.encode("event: ping\ndata:\n\n");

const encode = (event: RealtimeEvent) =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export const publish = (workspaceId: string, event: RealtimeEvent) => {
  const chunk = encode(event);

  for (const listener of listeners.get(workspaceId) ?? []) {
    listener.send(chunk);
  }
};

export const publishToUser = (userId: string, event: RealtimeEvent) => {
  const chunk = encode(event);

  for (const workspaceListeners of listeners.values()) {
    for (const listener of workspaceListeners) {
      if (listener.userId === userId) {
        listener.send(chunk);
      }
    }
  }
};

export const disconnect = (workspaceId: string, userId: string) => {
  for (const listener of listeners.get(workspaceId) ?? []) {
    if (listener.userId === userId) {
      listener.close();
    }
  }
};

export const closeWorkspace = (workspaceId: string) => {
  for (const listener of listeners.get(workspaceId) ?? []) {
    listener.close();
  }

  listeners.delete(workspaceId);
};

const openStream = (
  workspaceId: string,
  userId: string,
  signal: AbortSignal,
  isAllowed: () => Promise<boolean>
) => {
  if (!streams.acquire(userId)) {
    throw new ApiError(
      429,
      "rate_limited",
      `Up to ${env.STREAMS_PER_USER} live-update streams stay open per account; close a tab to free one`
    );
  }

  const workspaceListeners = listeners.get(workspaceId) ?? new Set<Listener>();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let pings = 0;

  const listener: Listener = {
    close: () => {
      if (workspaceListeners.has(listener)) {
        listener.stop();
        controller?.close();
      }
    },
    send: (chunk) => {
      if (workspaceListeners.has(listener)) {
        controller?.enqueue(chunk);
      }
    },
    stop: () => {
      clearInterval(ping);

      if (workspaceListeners.delete(listener)) {
        streams.release(userId);
      }
    },
    userId,
  };

  const closeUnlessAllowed = async () => {
    if (!(await isAllowed())) {
      listener.close();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    cancel: listener.stop,
    start: (streamController) => {
      controller = streamController;
      ping = setInterval(() => {
        listener.send(pingChunk);
        pings += 1;

        if (pings % pingsPerCheck === 0) {
          void closeUnlessAllowed();
        }
      }, pingMs);
      listeners.set(workspaceId, workspaceListeners);
      workspaceListeners.add(listener);
      listener.send(encoder.encode("retry: 3000\n\nevent: ping\ndata:\n\n"));
    },
  });

  signal.addEventListener("abort", listener.stop);

  if (signal.aborted) {
    listener.close();
  }

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};

export const streamWorkspace = async (
  actor: Actor,
  slug: string,
  request: Request
) => {
  const userId = new URL(request.url).searchParams.get("userId");

  if (userId !== null && userId !== actor.userId) {
    throw notFound("Workspace");
  }

  const workspace = await requireWorkspace(actor, slug);

  const isAllowed = async () => {
    try {
      const current = await resolveActor(request);

      await requireWorkspace(current, slug);

      return current.userId === actor.userId;
    } catch {
      return false;
    }
  };

  return openStream(workspace.id, actor.userId, request.signal, isAllowed);
};
