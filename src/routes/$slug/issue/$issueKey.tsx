import { createFileRoute } from "@tanstack/react-router";

import { IssueDetail } from "~/components/issue-detail";
import { loadIssue, preload } from "~/lib/preload";
import { pageHead } from "~/lib/site";

const View = () => <IssueDetail issueKey={Route.useParams().issueKey} />;

export const Route = createFileRoute("/$slug/issue/$issueKey")({
  component: View,
  loader: async ({ context, params }) => {
    await preload(async () => {
      await loadIssue(context.queryClient, params.issueKey);
    });
  },
  head: ({ params }) => pageHead(params.issueKey.toUpperCase()),
});
