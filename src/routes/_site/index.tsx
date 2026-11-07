import { createFileRoute, Navigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { lazy, Suspense } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { CenteredCard, FlintMark, SignIn } from "~/components/sign-in";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Skeleton } from "~/components/ui/skeleton";
import { signOut, useMe } from "~/lib/api";
import type { Me } from "~/lib/api-types";
import { pageHead } from "~/lib/site";
import { lastWorkspace } from "~/lib/workspace";

const SearchSchema = v.object({
  error: v.fallback(v.optional(v.picklist(["login"])), undefined),
});

const WorkspaceForm = lazy(async () => {
  const module = await import("~/components/workspace-dialog");

  return { default: module.WorkspaceForm };
});

const CreateFirstWorkspace = ({ me }: { me: Me }) => (
  <CenteredCard>
    <FlintMark />
    <div className="flex flex-col gap-2">
      <h1 className="text-lg font-medium">Create your first workspace</h1>
      <p className="text-muted-foreground">
        Or ask a workspace admin to add you.
      </p>
    </div>
    <div className="w-full text-left">
      <Suspense fallback={<Skeleton aria-busy className="h-72 w-full" />}>
        <WorkspaceForm cta />
      </Suspense>
    </div>
    <p className="text-muted-foreground text-xs">
      Signed in as{" "}
      <span className="text-foreground font-medium break-all">
        @{me.username}
      </span>{" "}
      ·{" "}
      <button
        className="hit-area text-foreground relative font-medium underline-offset-2 hover:underline"
        onClick={() => {
          void signOut();
        }}
        type="button"
      >
        Log out
      </button>
    </p>
  </CenteredCard>
);

const OpenWorkspace = ({ me }: { me: Me }) => {
  const remembered = lastWorkspace();

  const slug =
    me.workspaces.find((workspace) => workspace.slug === remembered)?.slug ??
    me.workspaces[0]?.slug ??
    "";

  return <Navigate params={{ slug }} replace to="/$slug/my-issues" />;
};

const Home = () => {
  const { error } = Route.useSearch();
  const me = useMe();

  if (me.isPending) {
    return (
      <div aria-busy className="m-auto">
        <h1 className="sr-only">Loading your account</h1>
        <FlintMark />
      </div>
    );
  }

  if (me.isError) {
    return (
      <CenteredCard>
        <FlintMark />
        <Alert className="text-left" variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            <h1>Flint could not load your account</h1>
          </AlertTitle>
          <AlertDescription>{me.error.message}</AlertDescription>
        </Alert>
      </CenteredCard>
    );
  }

  if (me.data === null) {
    return <SignIn failed={error === "login"} />;
  }

  if (me.data.workspaces.length > 0) {
    return <OpenWorkspace me={me.data} />;
  }

  return <CreateFirstWorkspace me={me.data} />;
};

export const Route = createFileRoute("/_site/")({
  validateSearch: SearchSchema,
  component: Home,
  head: () => pageHead("Home"),
});
