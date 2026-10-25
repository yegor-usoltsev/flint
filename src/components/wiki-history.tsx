import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { FileTextIcon } from "lucide-react";
import { useState } from "react";

import { LazyMarkdownEditor } from "~/components/lazy-editor";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { toast } from "~/components/ui/toast";
import { UserAvatar } from "~/components/user-avatar";
import { request } from "~/lib/api";
import type { WikiRevision, WikiRevisionSummary } from "~/lib/api-types";
import { diff, wordDiff } from "~/lib/line-diff";
import type { DiffPart } from "~/lib/line-diff";
import { notifyError } from "~/lib/notify";
import { setPage, wikiRevisionQuery, wikiRevisionsQuery } from "~/lib/wiki";
import type { Wiki } from "~/lib/wiki";

const dayFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});

const dayLabel = (date: Date) => {
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) /
      86_400_000
  );

  if (days === 0) {
    return "Today";
  }

  return days === 1 ? "Yesterday" : dayFormat.format(date);
};

const Stamp = ({ at }: { at: string }) => (
  <span>
    <span className="font-medium">{dayFormat.format(new Date(at))}</span>{" "}
    <span className="text-muted-foreground">
      {timeFormat.format(new Date(at))}
    </span>
  </span>
);

const changeClass = {
  added: "bg-diff-added",
  removed: "bg-diff-removed line-through decoration-1",
  same: "",
};

const Words = ({ parts }: { parts: DiffPart[] }) => (
  <>
    {parts.map((part, index) =>
      part.change === "same" ? (
        part.text
      ) : (
        <span
          className={cn("rounded-xs", changeClass[part.change])}
          key={index}
        >
          {part.text}
        </span>
      )
    )}
  </>
);

const lineClass = {
  added: "bg-diff-added/50",
  removed: "bg-diff-removed/50 text-muted-foreground",
  same: "",
};

interface DiffLine {
  change: DiffPart["change"];
  words?: DiffPart[];
  text: string;
}

const pairWords = (parts: DiffPart[]) => {
  const lines: DiffLine[] = [];
  let removed: DiffPart[] = [];
  let added: DiffPart[] = [];

  const flush = () => {
    if (removed.length === added.length) {
      const pairs = removed.map((line, at) =>
        wordDiff(line.text, added[at]?.text ?? "")
      );

      lines.push(
        ...removed.map((line, at) => ({
          ...line,
          words: pairs[at]?.filter((part) => part.change !== "added"),
        })),
        ...added.map((line, at) => ({
          ...line,
          words: pairs[at]?.filter((part) => part.change !== "removed"),
        }))
      );
    } else {
      lines.push(...removed, ...added);
    }

    removed = [];
    added = [];
  };

  for (const part of parts) {
    if (
      part.change === "same" ||
      (part.change === "removed" && added.length > 0)
    ) {
      flush();
    }

    if (part.change === "same") {
      lines.push(part);
    } else if (part.change === "removed") {
      removed.push(part);
    } else {
      added.push(part);
    }
  }

  flush();

  return lines;
};

const Changes = ({
  current,
  previous,
}: {
  current: WikiRevision;
  previous: WikiRevision | null;
}) => {
  const lines = pairWords(
    diff((previous ?? current).body.split("\n"), current.body.split("\n"))
  );

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-title">
        {previous === null || previous.title === current.title ? (
          current.title
        ) : (
          <Words parts={wordDiff(previous.title, current.title)} />
        )}
      </h3>
      <section
        aria-label="Changes from the previous version"
        className="font-mono text-xs leading-5 break-words whitespace-pre-wrap"
      >
        {lines.map((line, index) => (
          <div
            className={cn("-mx-2 rounded-sm px-2", lineClass[line.change])}
            // oxlint-disable-next-line react-doctor/no-array-index-as-key -- Diff lines are positional and never reorder.
            key={index}
          >
            {line.change === "same" ? null : (
              <span className="sr-only">
                {line.change === "added" ? "Added: " : "Removed: "}
              </span>
            )}
            {line.words === undefined ? (
              line.text || " "
            ) : (
              <Words parts={line.words} />
            )}
          </div>
        ))}
      </section>
    </div>
  );
};

const RevisionPane = ({
  current,
  onRestored,
  pageId,
  previous,
  selected,
  wiki,
}: {
  current: boolean;
  onRestored: () => void;
  pageId: string;
  previous: WikiRevisionSummary | undefined;
  selected: WikiRevisionSummary;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const [changes, setChanges] = useState(true);
  const revision = useQuery(wikiRevisionQuery(wiki, pageId, selected.revision));

  const before = useQuery({
    ...wikiRevisionQuery(wiki, pageId, previous?.revision ?? 0),
    enabled: previous !== undefined,
  });

  const restore = useMutation({
    mutationFn: async () =>
      await request("POST /wiki/:pageId/revisions/:revision/restore", {
        params: { pageId, revision: String(selected.revision) },
      }),
    onError: notifyError("Could not restore this version"),
    onSuccess: async (page) => {
      setPage(queryClient, wiki, page);
      toast.add({ title: "Version restored" });
      onRestored();
      await queryClient.invalidateQueries({
        queryKey: wikiRevisionsQuery(wiki, pageId).queryKey,
      });
    },
  });

  const loaded =
    revision.data !== undefined &&
    (previous === undefined || before.data !== undefined);

  return (
    <section
      aria-label="Selected version"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-20 md:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="bg-surface-2 rounded-md border px-2 py-0.5 text-xs">
            <Stamp at={selected.updatedAt} />
          </span>
          <label
            className="text-muted-foreground ml-auto flex items-center gap-2 text-xs"
            htmlFor="wiki-history-changes"
          >
            Show changes
            <Switch
              checked={changes}
              id="wiki-history-changes"
              onCheckedChange={setChanges}
              size="sm"
            />
          </label>
        </div>
        {loaded ? null : <Skeleton className="h-24 w-full" />}
        {revision.isError || before.isError ? (
          <p className="text-muted-foreground">
            This version could not load. It may have merged into a newer one.
          </p>
        ) : null}
        {loaded && changes ? (
          <Changes current={revision.data} previous={before.data ?? null} />
        ) : null}
        {loaded && !changes ? (
          <div className="flex flex-col gap-4">
            <h3 className="text-title">{revision.data.title}</h3>
            <LazyMarkdownEditor
              attachments={`/wiki/${pageId}/attachments`}
              className="text-prose"
              editable={false}
              label={`Version from ${dayFormat.format(new Date(selected.updatedAt))}`}
              value={revision.data.body}
            />
          </div>
        ) : null}
      </div>
      {current ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="bg-popover shadow-raised pointer-events-auto rounded-full border p-1">
            <Button
              disabled={restore.isPending || !loaded}
              onClick={() => {
                restore.mutate();
              }}
              size="pill"
            >
              Restore version
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

const RevisionList = ({
  onSelect,
  revisions,
  selected,
}: {
  onSelect: (revision: number) => void;
  revisions: WikiRevisionSummary[];
  selected: number;
}) => {
  const days = Map.groupBy(revisions, (revision) =>
    dayLabel(new Date(revision.updatedAt))
  );

  return (
    <nav
      aria-label="Versions"
      className="bg-surface-1 flex shrink-0 flex-col gap-3 overflow-y-auto p-2 max-md:max-h-56 max-md:border-b md:w-72 md:border-l"
    >
      {[...days].map(([day, list]) => (
        <section aria-label={day} className="flex flex-col gap-0.5" key={day}>
          <h3 className="text-muted-foreground px-2 py-1 text-xs">{day}</h3>
          {list.map((revision) => (
            <button
              aria-current={revision.revision === selected}
              className="hover:bg-accent aria-current:bg-accent focus-visible:ring-ring flex flex-col gap-1.5 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2"
              key={revision.revision}
              onClick={() => {
                onSelect(revision.revision);
              }}
              type="button"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <Stamp at={revision.updatedAt} />
                </span>
                {revision === revisions[0] ? (
                  <span className="rounded-sm border px-1.5 text-xs font-medium">
                    Current
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground flex items-center gap-2">
                <UserAvatar
                  avatarUrl={revision.author.avatarUrl}
                  className="size-4"
                  name={revision.author.displayName}
                />
                <span className="truncate">
                  {revision.author.displayName}
                  {revision.viaApi ? " via API" : null}
                </span>
              </span>
            </button>
          ))}
        </section>
      ))}
    </nav>
  );
};

const History = ({
  onClose,
  pageId,
  wiki,
}: {
  onClose: () => void;
  pageId: string;
  wiki: Wiki;
}) => {
  const revisions = useQuery(wikiRevisionsQuery(wiki, pageId));
  const [picked, setPicked] = useState<number | null>(null);
  const list = revisions.data ?? [];

  const index = Math.max(
    0,
    list.findIndex((revision) => revision.revision === picked)
  );

  const selected = list[index];

  return (
    <>
      <DialogTitle>
        <span className="flex min-w-0 items-center gap-1.5 pr-8">
          <span className="text-muted-foreground shrink-0 font-normal">
            History for
          </span>
          <FileTextIcon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{list[0]?.title}</span>
        </span>
      </DialogTitle>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border max-md:flex-col-reverse">
        {selected === undefined ? (
          <div className="flex-1 p-4">
            {revisions.isError ? (
              <p className="text-muted-foreground">History could not load.</p>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </div>
        ) : (
          <RevisionPane
            current={index === 0}
            key={selected.revision}
            onRestored={onClose}
            pageId={pageId}
            previous={list[index + 1]}
            selected={selected}
            wiki={wiki}
          />
        )}
        <RevisionList
          onSelect={setPicked}
          revisions={list}
          selected={selected?.revision ?? 0}
        />
      </div>
    </>
  );
};

export const WikiHistoryDialog = ({
  finalFocus,
  onOpenChange,
  open,
  pageId,
  wiki,
}: {
  finalFocus?: () => HTMLElement | true;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pageId: string;
  wiki: Wiki;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent
      className="flex h-200 max-h-11/12 flex-col sm:max-w-5xl"
      finalFocus={finalFocus}
    >
      {open ? (
        <History
          onClose={() => {
            onOpenChange(false);
          }}
          pageId={pageId}
          wiki={wiki}
        />
      ) : null}
    </DialogContent>
  </Dialog>
);
