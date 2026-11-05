import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { LoadFailed } from "~/components/load-failed";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
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
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { request } from "~/lib/api";
import type { ApiToken } from "~/lib/api-types";
import { notifyError } from "~/lib/notify";
import { tokensQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const formatDate = (value: string) => dateFormat.format(new Date(value));

const RevokeToken = ({ token }: { token: ApiToken }) => {
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: async () => {
      await request("DELETE /me/tokens/:tokenId", {
        params: { tokenId: token.id },
      });
    },
    onError: notifyError("API key not revoked"),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: tokensQuery.queryKey,
      });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button aria-label={`Revoke ${token.name}`} variant="ghost" />}
      >
        Revoke
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{token.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Anything that uses this key loses access immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={revoke.isPending}
            onClick={() => {
              revoke.mutate();
            }}
            variant="destructive"
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const inlineCode =
  "bg-surface-2 border-hairline rounded px-1 py-px font-mono text-xs";

const NewKey = ({ slug }: { slug: string }) => (
  <Link
    className={buttonVariants()}
    params={{ slug }}
    to="/$slug/settings/account/api-keys/new"
  >
    New API key
  </Link>
);

const TokenRows = () => {
  const tokens = useQuery(tokensQuery);

  if (tokens.isPending) {
    return <Skeleton className="my-3 h-9 w-full" />;
  }

  if (tokens.isError && tokens.data === undefined) {
    return (
      <div className="py-4">
        <LoadFailed
          error={tokens.error}
          onRetry={() => {
            void tokens.refetch();
          }}
          title="API keys could not load"
        />
      </div>
    );
  }

  if (tokens.data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No API keys yet</EmptyTitle>
          <EmptyDescription>
            Sign in the flint CLI with{" "}
            <code className={inlineCode}>flint login</code>, or set a key as{" "}
            <code className={inlineCode}>FLINT_TOKEN</code> in your scripts.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return tokens.data.map((token) => (
    <SettingsRow
      description={
        <>
          <code className="font-mono">{token.prefix}…</code> ·{" "}
          {token.workspaces?.map(({ name }) => name).join(", ") ??
            "All workspaces"}{" "}
          · Created {formatDate(token.createdAt)} ·{" "}
          {token.lastUsedAt === null
            ? "Never used"
            : `Last used ${formatDate(token.lastUsedAt)}`}
        </>
      }
      key={token.id}
      label={token.name}
    >
      <RevokeToken token={token} />
    </SettingsRow>
  ));
};

const ApiKeys = () => {
  const { slug } = useWorkspace();

  return (
    <SettingsPage
      actions={<NewKey slug={slug} />}
      description="The flint CLI and your scripts use the API as you with these keys."
      title="API keys"
    >
      <SettingsSection>
        <TokenRows />
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/api-keys/")({
  component: ApiKeys,
  head: () => pageHead("API keys"),
});
