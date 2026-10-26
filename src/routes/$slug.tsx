import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import { LockIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { AppSidebar } from "~/components/app-sidebar";
import { CommandLayer } from "~/components/command-palette";
import { CreateIssueProvider } from "~/components/create-issue";
import { Page } from "~/components/page";
import { RouteNotFound } from "~/components/route-not-found";
import { SelectionBar } from "~/components/selection-bar";
import { SettingsSidebar } from "~/components/settings-sidebar";
import { FlintMark, SignIn } from "~/components/sign-in";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useMe } from "~/lib/api";
import type { Workspace } from "~/lib/api-types";
import { rememberAppLocation } from "~/lib/back-to-app";
import { RealtimeStatus, useRealtime } from "~/lib/realtime";
import { adoptDrafts } from "~/lib/use-draft";
import { useWorkspace } from "~/lib/use-workspace";
import { followWorkspace, rememberWorkspace } from "~/lib/workspace";

const readSidebarOpen = () =>
  !document.cookie.split("; ").includes("sidebar_state=false");

const Loading = () => (
  <main aria-busy className="bg-sidebar flex h-svh" id="main">
    <h1 className="sr-only">Loading Flint</h1>
    <FlintMark className="m-auto" />
  </main>
);

const NoAccess = ({ name }: { name: string }) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <LockIcon />
      </EmptyMedia>
      <EmptyTitle>
        <h1>You no longer have access to {name}</h1>
      </EmptyTitle>
      <EmptyDescription>
        An admin removed you from this workspace, or it was deleted.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Link className={buttonVariants()} to="/">
        Back home
      </Link>
    </EmptyContent>
  </Empty>
);

const WorkspaceLayout = () => {
  const { slug } = Route.useParams();
  const me = useMe();
  const workspace = me.data?.workspaces.find((item) => item.slug === slug);
  const connected = useRealtime(slug, workspace !== undefined);
  const href = useLocation({ select: (location) => location.href });
  const pathname = useLocation({ select: (location) => location.pathname });
  const router = useRouter();
  const [seen, setSeen] = useState<Workspace | null>(null);

  if (workspace !== undefined && workspace !== seen) {
    setSeen(workspace);
  }

  const followed =
    me.data && workspace === undefined
      ? followWorkspace(seen, slug, me.data.workspaces)
      : null;

  const movedTo = followed?.kind === "moved" ? followed.slug : null;

  const inSettings =
    useMatch({ from: "/$slug/settings", shouldThrow: false }) !== undefined;

  useEffect(() => {
    rememberAppLocation({ href, pathname });
  }, [href, pathname]);

  const userId = me.data?.id;

  useEffect(() => {
    if (userId !== undefined) {
      adoptDrafts(userId);
    }
  }, [userId]);

  useEffect(() => {
    if (workspace !== undefined) {
      rememberWorkspace(workspace.slug);
    }
  }, [workspace]);

  useEffect(() => {
    const next =
      movedTo === null ? href : href.replace(/^\/[^/?#]+/u, `/${movedTo}`);

    if (next !== href) {
      router.history.replace(next);
    }
  }, [href, movedTo, router]);

  if (me.isPending || movedTo !== null) {
    return <Loading />;
  }

  if (me.isError && me.data === undefined) {
    return (
      <main className="p-4" id="main">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            <h1>Flint could not load your account</h1>
          </AlertTitle>
          <AlertDescription>{me.error.message}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (me.data === null) {
    return (
      <main className="flex min-h-dvh p-4" id="main">
        <SignIn returnTo={href} />
      </main>
    );
  }

  if (workspace === undefined) {
    return (
      <main className="flex min-h-dvh p-4" id="main">
        {followed?.kind === "gone" ? (
          <NoAccess name={followed.name} />
        ) : (
          <RouteNotFound />
        )}
      </main>
    );
  }

  return (
    <RealtimeStatus value={connected}>
      <CreateIssueProvider>
        <SidebarProvider className="h-svh" defaultOpen={readSidebarOpen()}>
          <CommandLayer>
            {inSettings ? (
              <SettingsSidebar slug={slug} />
            ) : (
              <AppSidebar me={me.data} workspace={workspace} />
            )}
            <SidebarInset className="min-h-0 overflow-hidden" id="main">
              <Outlet />
              <SelectionBar />
            </SidebarInset>
          </CommandLayer>
        </SidebarProvider>
      </CreateIssueProvider>
    </RealtimeStatus>
  );
};

const AppNotFound = () => {
  const workspace = useWorkspace();

  return (
    <Page
      className="flex p-4"
      crumbs={[
        {
          label: workspace.name,
          link: (
            <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />
          ),
          short: workspace.name,
        },
      ]}
      title="Page not found"
    >
      <RouteNotFound inPage />
    </Page>
  );
};

export const Route = createFileRoute("/$slug")({
  component: WorkspaceLayout,
  notFoundComponent: AppNotFound,
});
