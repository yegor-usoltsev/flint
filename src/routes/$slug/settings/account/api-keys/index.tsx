import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";

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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { request } from "~/lib/api";
import type { ApiToken } from "~/lib/api-types";
import { copyText } from "~/lib/copy";
import { loginCommand } from "~/lib/loopback";
import { notifyError } from "~/lib/notify";
import { tokensQuery } from "~/lib/queries";
import { pageHead, site } from "~/lib/site";
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

const CopyCode = ({
  copy,
  text,
  what,
}: {
  copy?: () => string;
  text: string;
  what: string;
}) => (
  <button
    aria-label={`Copy ${text}`}
    className="bg-surface-2 border-hairline hover:bg-surface-3 focus-visible:ring-ring/50 hit-area relative rounded px-1 py-px font-mono text-xs outline-none focus-visible:ring-2"
    onClick={() => {
      void copyText(copy?.() ?? text, what);
    }}
    type="button"
  >
    {text}
  </button>
);

const NewKey = ({ slug }: { slug: string }) => (
  <Link
    className={buttonVariants({ className: "max-sm:h-10" })}
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
            <span className="leading-7">
              Sign in the flint CLI with{" "}
              <CopyCode
                copy={() => loginCommand(window.location.origin)}
                text="flint login"
                what="command"
              />
              , or set a key as{" "}
              <CopyCode text="FLINT_TOKEN" what="variable name" /> in your
              scripts.
            </span>
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a
            className={buttonVariants({
              className: "max-sm:h-10",
              variant: "outline",
            })}
            href={site.cliGuide}
            rel="noreferrer"
            target="_blank"
          >
            CLI guide
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </EmptyContent>
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
