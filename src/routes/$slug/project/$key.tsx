import { createFileRoute } from "@tanstack/react-router";

import { IssuesView } from "~/components/issues-view";
import { IssueSearchSchema } from "~/lib/issue-view";
import { loadProject, preload } from "~/lib/preload";
import { pageHead } from "~/lib/site";

const View = () => {
  const search = Route.useSearch({
    select: ({ issue: _shown, ...filters }) => filters,
    structuralSharing: true,
  });

  return <IssuesView projectKey={Route.useParams().key} search={search} />;
};

export const Route = createFileRoute("/$slug/project/$key")({
  validateSearch: IssueSearchSchema,
  component: View,
  loader: async ({ context, params }) => {
    await preload(async () => {
      await loadProject(context.queryClient, params.key);
    });
  },
  head: ({ params }) => pageHead(params.key),
});
