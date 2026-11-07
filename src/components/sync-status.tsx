import { cn } from "cn";
import { useEffect, useSyncExternalStore } from "react";

import { useConnection } from "~/lib/realtime";
import { createSyncStatus } from "~/lib/sync-status";
import type { SyncPill } from "~/lib/sync-status";
import { usePendingIssueWrites } from "~/lib/use-update-issue";

const copy: Record<SyncPill, { color: string; text: string }> = {
  offline: { color: "amber", text: "Offline · changes will sync" },
  reconnecting: { color: "amber", text: "Reconnecting…" },
  saving: { color: "amber", text: "Saving…" },
  synced: { color: "green", text: "Synced" },
};

const status = createSyncStatus();

export const useSyncShown = () =>
  useSyncExternalStore(status.subscribe, status.get, () => null);

export const SyncText = ({
  className,
  hidden = true,
}: {
  className?: string;
  hidden?: boolean;
}) => {
  const shown = useSyncShown();

  if (shown === null) {
    return null;
  }

  const { color, text } = copy[shown.pill];

  return (
    <span
      aria-hidden={hidden ? true : undefined}
      className={cn(
        "text-muted-foreground animate-in fade-in flex min-w-0 items-center gap-1.5 text-xs font-normal whitespace-nowrap transition-opacity duration-180",
        shown.leaving && "opacity-0",
        className
      )}
      data-color={color}
    >
      <span aria-hidden className="bg-swatch size-1.5 shrink-0 rounded-full" />
      <span className="truncate">{text}</span>
    </span>
  );
};

export const SyncStatus = () => {
  const connection = useConnection();
  const pending = usePendingIssueWrites();

  useEffect(() => {
    status.update({ connection, pending });
  }, [connection, pending]);

  useEffect(() => status.dispose, []);

  return (
    <output aria-live="polite" className="sr-only">
      <SyncText hidden={false} />
    </output>
  );
};
