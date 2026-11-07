import { endpointPath } from "~/lib/endpoints";
import type { Endpoint } from "~/lib/endpoints";
import { slugProblem } from "~/lib/workspace";

const preload = (
  endpoint: Endpoint,
  slug = "",
  query: { counts?: boolean } = {}
) =>
  `</api/v1${endpointPath(endpoint, { slug }, query).path}>; rel=preload; as=fetch; crossorigin`;

export const bootPreloads = (pathname: string) => {
  const slug = pathname.split("/")[1] ?? "";

  if (slug === "") {
    return preload("GET /me");
  }

  if (slugProblem(slug) !== null) {
    return null;
  }

  return [
    preload("GET /me"),
    preload("GET /workspaces/:slug/projects", slug, { counts: false }),
    preload("GET /workspaces/:slug/labels", slug, { counts: false }),
    preload("GET /workspaces/:slug/members", slug),
  ].join(", ");
};
