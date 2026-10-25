import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { LinkResolver } from "~/components/link-resolver";
import { projectQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";

const ResolveIssue = () => {
  const issueKey = Route.useParams().issueKey.toUpperCase();
  const project = useQuery(projectQuery(issueKey.split("-")[0] ?? ""));

  if (project.data === undefined) {
    return <LinkResolver query={project} title={issueKey} />;
  }

  return (
    <Navigate
      params={{ issueKey, slug: project.data.workspaceSlug }}
      replace
      to="/$slug/issue/$issueKey"
    />
  );
};

export const Route = createFileRoute("/issue/$issueKey")({
  component: ResolveIssue,
  head: ({ params }) => pageHead(params.issueKey.toUpperCase()),
});
