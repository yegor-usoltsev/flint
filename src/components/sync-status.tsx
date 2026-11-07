import { cn } from "cn";
import { useEffect, useSyncExternalStore } from "react";

import { useSelection } from "~/lib/issue-selection";
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

export const SyncStatus = () => {
  const connection = useConnection();
  const pending = usePendingIssueWrites();
  const selecting = useSelection().ids.size > 0;
  const shown = useSyncExternalStore(status.subscribe, status.get, () => null);

  useEffect(() => {
    status.update({ connection, pending });
  }, [connection, pending]);

  useEffect(() => status.dispose, []);

  const pill = shown === null ? null : copy[shown.pill];

  return (
    <output
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute left-3 z-20",
        selecting ? "bottom-18" : "bottom-3"
      )}
    >
      {pill === null || shown === null ? null : (
        <span
          className={cn(
            "bg-popover text-muted-foreground shadow-menu hit-area animate-in fade-in pointer-events-auto relative flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition-opacity duration-180",
            shown.leaving && "opacity-0"
          )}
          data-color={pill.color}
        >
          <span aria-hidden className="bg-swatch size-1.5 rounded-full" />
          {pill.text}
        </span>
      )}
    </output>
  );
};
