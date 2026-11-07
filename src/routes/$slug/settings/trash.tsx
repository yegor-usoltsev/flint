import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CircleDotIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderIcon,
  RotateCcwIcon,
  TrashIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { LoadFailed } from "~/components/load-failed";
import {
  SettingsFilter,
  SettingsPage,
  SettingsTable,
  TableEmpty,
  tableDate,
  tableGroup,
  tableHead,
  tableRow,
} from "~/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toast";
import { UserAvatar } from "~/components/user-avatar";
import { request, useMe } from "~/lib/api";
import type { TrashedIssue, TrashedPage, UserRef } from "~/lib/api-types";
import { formatDate } from "~/lib/issue-view";
import { notifyError } from "~/lib/notify";
import { trashQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const DeletedBy = ({ user }: { user: UserRef | null }) => (
  <span className="text-muted-foreground flex w-32 shrink-0 items-center gap-2 @max-2xl/trash:hidden">
    {user === null ? null : (
      <>
        <UserAvatar
          avatarUrl={user.avatarUrl}
          className="size-5"
          name={user.displayName}
        />
        <span className="truncate">{user.displayName}</span>
      </>
    )}
  </span>
);

const DeleteForever = ({
  description,
  name,
  onDelete,
  onOpenChange,
  open,
}: {
  description: string;
  name: string;
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <AlertDialog onOpenChange={onOpenChange} open={open}>
    <AlertDialogTrigger
      render={
        <Button
          aria-label={`Delete ${name} forever`}
          className="max-md:hidden"
          size="icon-sm"
          variant="quiet"
        />
      }
    >
      <TrashIcon />
    </AlertDialogTrigger>
    <AlertDialogContent className="wrap-anywhere">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{name}” forever?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onDelete} variant="destructive">
          Delete forever
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const RowMenu = ({
  isAdmin,
  name,
  onPurge,
  onRestore,
  pending,
}: {
  isAdmin: boolean;
  name: string;
  onPurge: () => void;
  onRestore: () => void;
  pending: boolean;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          aria-label={`Actions for ${name}`}
          className="md:hidden"
          size="icon"
          variant="ghost"
        />
      }
    >
      <EllipsisIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuItem disabled={pending} onClick={onRestore}>
        <RotateCcwIcon />
        Restore
      </DropdownMenuItem>
      {isAdmin ? (
        <DropdownMenuItem
          disabled={pending}
          onClick={onPurge}
          variant="destructive"
        >
          <TrashIcon />
          Delete forever
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);

const useTrashAction = (
  slug: string,
  run: () => Promise<void>,
  {
    failure,
    refreshed,
    success,
  }: {
    failure: string;
    refreshed: string[][];
    success: string;
  }
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onError: notifyError(failure),
    onSuccess: () => {
      toast.add({ title: success });
    },
    onSettled: async () => {
      await Promise.all(
        [trashQuery(slug).queryKey, ...refreshed].map(async (queryKey) => {
          await queryClient.invalidateQueries({ queryKey });
        })
      );
    },
  });
};

const dayMs = 86_400_000;

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);

const daysLeft = (purgeAt: string, now = Date.now()) =>
  Math.max(
    0,
    Math.round(
      (startOfDay(new Date(purgeAt).getTime()) - startOfDay(now)) / dayMs
    )
  );

const expiresText = (days: number) => {
  if (days === 0) {
    return "today";
  }

  return days === 1 ? "tomorrow" : `in ${days} days`;
};

const ExpiresIn = ({ purgeAt }: { purgeAt: string }) => (
  <span className={tableDate}>
    <span className="sr-only">Deleted forever </span>
    {expiresText(daysLeft(purgeAt))}
  </span>
);

const ExpiresLine = ({
  deletedAt,
  purgeAt,
}: {
  deletedAt: string;
  purgeAt: string;
}) => (
  <span className="text-muted-foreground pl-6 text-xs">
    Deleted {formatDate(deletedAt)}
    <span className="md:hidden">
      , deleted forever {expiresText(daysLeft(purgeAt))}
    </span>
  </span>
);

const TrashRow = ({
  children,
  deletedAt,
  deletedBy,
  isAdmin,
  name,
  onPurge,
  onRestore,
  pending,
  purgeAt,
  purgeText,
}: {
  children: ReactNode;
  deletedAt: string;
  deletedBy: UserRef | null;
  isAdmin: boolean;
  name: string;
  onPurge: () => void;
  onRestore: () => void;
  pending: boolean;
  purgeAt: string;
  purgeText: string;
}) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className={cn(tableRow, "max-md:py-1.5")}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-2">{children}</div>
        <ExpiresLine deletedAt={deletedAt} purgeAt={purgeAt} />
      </div>
      <DeletedBy user={deletedBy} />
      <ExpiresIn purgeAt={purgeAt} />
      <div className="flex shrink-0 items-center justify-end gap-1 md:w-26">
        <Button
          className="max-md:hidden"
          disabled={pending}
          onClick={onRestore}
          size="sm"
          variant="outline"
        >
          Restore
        </Button>
        {isAdmin ? (
          <DeleteForever
            description={purgeText}
            name={name}
            onDelete={onPurge}
            onOpenChange={setConfirming}
            open={confirming}
          />
        ) : null}
        <RowMenu
          isAdmin={isAdmin}
          name={name}
          onPurge={() => {
            setConfirming(true);
          }}
          onRestore={onRestore}
          pending={pending}
        />
      </div>
    </li>
  );
};

const IssueRow = ({
  isAdmin,
  issue,
  slug,
}: {
  isAdmin: boolean;
  issue: TrashedIssue;
  slug: string;
}) => {
  const restore = useTrashAction(
    slug,
    async () => {
      await request("POST /issues/:issueKey/restore", {
        params: { issueKey: issue.key },
      });
    },
    {
      failure: `Could not restore ${issue.key}`,
      refreshed: [["issues"]],
      success: `Restored ${issue.key}`,
    }
  );

  const purge = useTrashAction(
    slug,
    async () => {
      await request("DELETE /trash/issues/:issueKey", {
        params: { issueKey: issue.key },
      });
    },
    {
      failure: `Could not delete ${issue.key}`,
      refreshed: [],
      success: `Deleted ${issue.key} forever`,
    }
  );

  return (
    <TrashRow
      deletedAt={issue.deletedAt}
      purgeAt={issue.purgeAt}
      deletedBy={issue.deletedBy}
      isAdmin={isAdmin}
      name={issue.key}
      onPurge={() => {
        purge.mutate();
      }}
      onRestore={() => {
        restore.mutate();
      }}
      pending={restore.isPending || purge.isPending}
      purgeText="The issue, its comments, activity and attachments are deleted for everyone. This cannot be undone."
    >
      <CircleDotIcon
        aria-hidden
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
      />
      <span className="text-muted-foreground tracking-key shrink-0 tabular-nums">
        {issue.key}
      </span>
      <Link
        className="line-clamp-2 font-medium wrap-anywhere hover:underline"
        params={{ issueKey: issue.key, slug }}
        to="/$slug/issue/$issueKey"
      >
        {issue.title}
      </Link>
    </TrashRow>
  );
};

const inside = (count: number) => {
  if (count === 0) {
    return "";
  }

  return count === 1
    ? " and 1 page inside it"
    : ` and ${count} pages inside it`;
};

const PageRow = ({
  isAdmin,
  page,
  slug,
}: {
  isAdmin: boolean;
  page: TrashedPage;
  slug: string;
}) => {
  const restore = useTrashAction(
    slug,
    async () => {
      await request("POST /wiki/:pageId/restore", {
        params: { pageId: page.id },
      });
    },
    {
      failure: `Could not restore ${page.title}`,
      refreshed: [["wiki", slug]],
      success: `Restored ${page.title}`,
    }
  );

  const purge = useTrashAction(
    slug,
    async () => {
      await request("DELETE /trash/wiki/:pageId", {
        params: { pageId: page.id },
      });
    },
    {
      failure: `Could not delete ${page.title}`,
      refreshed: [],
      success: `Deleted ${page.title} forever`,
    }
  );

  const Icon = page.kind === "folder" ? FolderIcon : FileTextIcon;

  return (
    <TrashRow
      deletedAt={page.deletedAt}
      purgeAt={page.purgeAt}
      deletedBy={page.deletedBy}
      isAdmin={isAdmin}
      name={page.title}
      onPurge={() => {
        purge.mutate();
      }}
      onRestore={() => {
        restore.mutate();
      }}
      pending={restore.isPending || purge.isPending}
      purgeText={`The ${page.kind}${inside(page.descendants)} are deleted for everyone with their history and attachments. This cannot be undone.`}
    >
      <Icon
        aria-hidden
        className="text-muted-foreground mt-2 size-4 shrink-0"
      />
      <span className="flex min-w-0 flex-col py-1.5">
        <span className="font-medium wrap-anywhere">{page.title}</span>
        <span className="text-muted-foreground text-xs wrap-anywhere md:truncate">
          {page.path}
          {page.descendants > 0 ? ` · ${page.descendants} inside` : ""}
        </span>
      </span>
    </TrashRow>
  );
};

const matches = (words: string, ...texts: string[]) =>
  texts.some((text) => text.toLowerCase().includes(words));

const TrashTable = ({
  count,
  filter,
  isAdmin,
  issues,
  onFilter,
  pages,
  slug,
}: {
  count: number;
  filter: string;
  isAdmin: boolean;
  issues: TrashedIssue[];
  onFilter: (filter: string) => void;
  pages: TrashedPage[];
  slug: string;
}) => (
  <>
    <SettingsFilter
      count={count}
      label="Filter by title"
      onChange={onFilter}
      value={filter}
    />
    <SettingsTable>
      <div aria-hidden className={tableHead}>
        <span className="flex-1">Name</span>
        <span className="w-32 shrink-0 @max-2xl/trash:hidden">Deleted by</span>
        <span className={cn(tableDate, "whitespace-nowrap")}>
          Deleted forever
        </span>
        <span className="w-8 shrink-0 md:w-26" />
      </div>
      {issues.length === 0 && pages.length === 0 ? (
        <TableEmpty
          description=""
          filter={filter.trim()}
          onClearFilter={() => {
            onFilter("");
          }}
          title=""
        />
      ) : null}
      {issues.length === 0 ? null : (
        <section aria-label="Issues">
          <h2 className={tableGroup}>
            Issues
            <span className="text-muted-foreground font-normal">
              {issues.length}
            </span>
          </h2>
          <ul>
            {issues.map((issue) => (
              <IssueRow
                isAdmin={isAdmin}
                issue={issue}
                key={issue.id}
                slug={slug}
              />
            ))}
          </ul>
        </section>
      )}
      {pages.length === 0 ? null : (
        <section aria-label="Wiki pages">
          <h2 className={tableGroup}>
            Wiki pages
            <span className="text-muted-foreground font-normal">
              {pages.length}
            </span>
          </h2>
          <ul>
            {pages.map((page) => (
              <PageRow
                isAdmin={isAdmin}
                key={page.id}
                page={page}
                slug={slug}
              />
            ))}
          </ul>
        </section>
      )}
    </SettingsTable>
  </>
);

const Trash = () => {
  const workspace = useWorkspace();
  const trashDays = useMe().data?.trashDays;
  const trash = useQuery(trashQuery(workspace.slug));
  const [filter, setFilter] = useState("");
  const words = filter.trim().toLowerCase();
  const isAdmin = workspace.role === "admin";

  const issues =
    trash.data?.issues.filter((issue) =>
      matches(words, issue.key, issue.title)
    ) ?? [];

  const pages =
    trash.data?.pages.filter((page) => matches(words, page.title, page.path)) ??
    [];

  const empty =
    trash.data !== undefined &&
    trash.data.issues.length === 0 &&
    trash.data.pages.length === 0;

  return (
    <SettingsPage
      description={`Deleted issues and wiki pages stay here for ${trashDays} days, then they are deleted forever. Anyone can restore them; only admins can delete them sooner.`}
      title="Trash"
    >
      <div className="@container/trash flex flex-col gap-2">
        {trash.isPending ? <Skeleton className="h-20 w-full" /> : null}
        {trash.isError && trash.data === undefined ? (
          <LoadFailed
            error={trash.error}
            onRetry={() => {
              void trash.refetch();
            }}
            title="Trash could not load"
          />
        ) : null}
        {empty ? (
          <SettingsTable>
            <TableEmpty
              description="Deleted issues and wiki pages show up here."
              filter=""
              onClearFilter={() => {
                setFilter("");
              }}
              title="Trash is empty"
            />
          </SettingsTable>
        ) : null}
        {trash.data === undefined || empty ? null : (
          <TrashTable
            count={trash.data.issues.length + trash.data.pages.length}
            filter={filter}
            isAdmin={isAdmin}
            issues={issues}
            onFilter={setFilter}
            pages={pages}
            slug={workspace.slug}
          />
        )}
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/trash")({
  component: Trash,
  head: () => pageHead("Trash"),
});
