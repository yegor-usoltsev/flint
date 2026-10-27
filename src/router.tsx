import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PagePending } from "~/components/page";
import { RouteError } from "~/components/route-error";
import { RouteNotFound } from "~/components/route-not-found";
import { rememberImportFailure } from "~/lib/import-recovery";
import type { IssueOrigin } from "~/lib/issue-view";
import { routeTree } from "~/routeTree.gen";

const NotFound = () => <RouteNotFound />;

export const getRouter = () => {
  if (typeof window !== "undefined") {
    window.addEventListener("vite:preloadError", rememberImportFailure);
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });

  const QueryProvider = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return createRouter({
    context: { queryClient },
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    defaultPendingComponent: PagePending,
    defaultPendingMs: 300,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    routeTree,
    scrollRestoration: true,
    Wrap: QueryProvider,
  });
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    from?: IssueOrigin;
    walk?: string[];
  }

  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
