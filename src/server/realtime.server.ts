import type { RealtimeEvent } from "~/lib/api-types";
import { notFound, requireWorkspace } from "~/server/access.server";
import { resolveActor } from "~/server/api.server";
import type { Actor } from "~/server/api.server";

interface Listener {
  close: () => void;
  send: (chunk: string) => void;
  stop: () => void;
  userId: string;
}

const pingMs = 5000;
const pingsPerCheck = 6;
const listeners = new Map<string, Set<Listener>>();
const encoder = new TextEncoder();

export const publish = (workspaceId: string, event: RealtimeEvent) => {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;

  for (const listener of listeners.get(workspaceId) ?? []) {
    listener.send(chunk);
  }
};

export const publishToUser = (userId: string, event: RealtimeEvent) => {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;

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
        controller?.enqueue(encoder.encode(chunk));
      }
    },
    stop: () => {
      clearInterval(ping);
      workspaceListeners.delete(listener);
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
        listener.send(": ping\n\n");
        pings += 1;

        if (pings % pingsPerCheck === 0) {
          void closeUnlessAllowed();
        }
      }, pingMs);
      listeners.set(workspaceId, workspaceListeners);
      workspaceListeners.add(listener);
      listener.send("retry: 3000\n\n");
    },
  });

  signal.addEventListener("abort", listener.stop);

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
