import { createFileRoute } from "@tanstack/react-router";

import { WorkspaceWiki } from "~/components/wiki-page";
import { loadWiki, preload } from "~/lib/preload";
import { pageHead } from "~/lib/site";

const View = () => <WorkspaceWiki path={Route.useParams()._splat ?? ""} />;

export const Route = createFileRoute("/$slug/wiki/$")({
  component: View,
  loader: async ({ context, params }) => {
    await preload(async () => {
      await loadWiki(context.queryClient, params.slug, params._splat ?? "");
    });
  },
  head: ({ params }) =>
    pageHead(
      params._splat === undefined || params._splat === ""
        ? "Wiki"
        : params._splat
    ),
});
