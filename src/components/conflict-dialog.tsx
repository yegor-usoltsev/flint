import { CopyIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { copyText } from "~/lib/copy";
import { changedLines } from "~/lib/line-diff";

export const SaveState = ({
  idle = null,
  onRetry,
  problem = null,
  status,
}: {
  idle?: string | null;
  onRetry: () => void;
  problem?: string | null;
  status: string;
}) => {
  if (status === "error" && problem !== null) {
    return (
      <p className="text-destructive text-xs" role="alert">
        {problem}
      </p>
    );
  }

  if (status === "error") {
    return (
      <button
        className="text-destructive hit-area relative text-xs underline-offset-2 hover:underline"
        onClick={onRetry}
        type="button"
      >
        Not saved · Retry
      </button>
    );
  }

  return (
    <span aria-live="polite" className="text-muted-foreground text-xs">
      {status === "saving" || status === "pending" ? "Saving…" : idle}
    </span>
  );
};

export const ConflictDialog = ({
  field,
  mine,
  onKeepMine,
  onUseTheirs,
  saved,
}: {
  field: string;
  mine: string;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  saved: string | null;
}) => {
  const changed = saved === null ? null : changedLines(mine, saved);

  return (
    <Dialog open={saved !== null}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>The {field} changed while you were editing</DialogTitle>
          <DialogDescription>
            Someone saved a different {field}. Your text is kept below with the
            differing lines highlighted; choose which version to keep.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto md:grid-cols-2">
          {[
            { changed: changed?.mine, label: "Your version", text: mine },
            {
              changed: changed?.theirs,
              label: "Saved version",
              text: saved ?? "",
            },
          ].map((version) => (
            <section
              className="flex min-w-0 flex-col gap-1.5"
              key={version.label}
            >
              <h3 className="text-muted-foreground text-xs font-medium">
                {version.label}
              </h3>
              <pre className="bg-surface-1 min-h-24 rounded-lg border p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                {version.text.split("\n").map((line, index) =>
                  version.changed?.has(index) === true ? (
                    <mark
                      className="bg-primary/15 text-foreground -mx-3 block px-3"
                      key={index}
                    >
                      {line || " "}
                    </mark>
                  ) : (
                    <span className="block" key={index}>
                      {line || " "}
                    </span>
                  )
                )}
              </pre>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              void copyText(mine, `your ${field}`);
            }}
            variant="ghost"
          >
            <CopyIcon data-icon="inline-start" />
            Copy mine
          </Button>
          <Button onClick={onUseTheirs} variant="outline">
            Use saved version
          </Button>
          <Button onClick={onKeepMine}>Keep my version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
