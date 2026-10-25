import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileTextIcon, FolderIcon, TrashIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { LoadFailed } from "~/components/load-failed";
import {
  SettingsFilter,
  SettingsPage,
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
  <span className="text-muted-foreground flex w-40 shrink-0 items-center gap-2 max-md:hidden">
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
}: {
  description: string;
  name: string;
  onDelete: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger
      render={
        <Button
          aria-label={`Delete ${name} forever`}
          size="icon-sm"
          variant="ghost"
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

const TrashRow = ({
  children,
  deletedAt,
  deletedBy,
  isAdmin,
  name,
  onPurge,
  onRestore,
  pending,
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
  purgeText: string;
}) => (
  <li className={tableRow}>
    <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    <DeletedBy user={deletedBy} />
    <span className={tableDate}>
      <span className="sr-only">Deleted </span>
      {formatDate(deletedAt)}
    </span>
    <div className="flex w-28 shrink-0 items-center justify-end gap-1">
      <Button
        disabled={pending}
        onClick={onRestore}
        size="sm"
        variant="outline"
      >
        Restore
      </Button>
      {isAdmin ? (
        <DeleteForever description={purgeText} name={name} onDelete={onPurge} />
      ) : null}
    </div>
  </li>
);

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
      <span className="text-muted-foreground tracking-key shrink-0 tabular-nums">
        {issue.key}
      </span>
      <Link
        className="truncate font-medium hover:underline"
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
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="truncate font-medium">{page.title}</span>
      <span className="text-muted-foreground truncate max-sm:hidden">
        {page.path}
        {page.descendants > 0 ? ` · ${page.descendants} inside` : ""}
      </span>
    </TrashRow>
  );
};

const matches = (words: string, ...texts: string[]) =>
  texts.some((text) => text.toLowerCase().includes(words));

const TrashTable = ({
  filter,
  isAdmin,
  issues,
  onFilter,
  pages,
  slug,
}: {
  filter: string;
  isAdmin: boolean;
  issues: TrashedIssue[];
  onFilter: (filter: string) => void;
  pages: TrashedPage[];
  slug: string;
}) => (
  <>
    <SettingsFilter
      label="Filter by title"
      onChange={onFilter}
      value={filter}
    />
    <div aria-hidden className={tableHead}>
      <span className="flex-1">Name</span>
      <span className="w-40 shrink-0 max-md:hidden">Deleted by</span>
      <span className={tableDate}>Deleted</span>
      <span className="w-28 shrink-0" />
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
            <PageRow isAdmin={isAdmin} key={page.id} page={page} slug={slug} />
          ))}
        </ul>
      </section>
    )}
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
      wide
    >
      <div className="flex flex-col gap-2">
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
          <TableEmpty
            description="Deleted issues and wiki pages show up here."
            filter=""
            onClearFilter={() => {
              setFilter("");
            }}
            title="Trash is empty"
          />
        ) : null}
        {trash.data === undefined || empty ? null : (
          <TrashTable
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
