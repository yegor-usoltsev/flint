import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { LinkResolver } from "~/components/link-resolver";
import { api } from "~/lib/api";
import type { WikiPage } from "~/lib/api-types";
import { pageHead } from "~/lib/site";

const ResolveDoc = () => {
  const { pageId } = Route.useParams();

  const page = useQuery({
    queryFn: async () =>
      await api<WikiPage & { workspaceSlug: string }>(`/wiki/${pageId}`),
    queryKey: ["doc", pageId],
    refetchOnMount: "always",
  });

  if (!page.isFetchedAfterMount || page.isError || page.data === undefined) {
    return <LinkResolver query={page} title="wiki page" />;
  }

  return (
    <Navigate
      params={{ _splat: page.data.path, slug: page.data.workspaceSlug }}
      replace
      to="/$slug/wiki/$"
    />
  );
};

export const Route = createFileRoute("/doc/$pageId")({
  component: ResolveDoc,
  head: () => pageHead("Wiki"),
});
