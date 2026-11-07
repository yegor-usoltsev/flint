import { endpointPath } from "~/lib/endpoints";
import type { Endpoint } from "~/lib/endpoints";
import { slugProblem } from "~/lib/workspace";

const preload = (endpoint: Endpoint, slug = "") =>
  `</api/v1${endpointPath(endpoint, { slug }).path}>; rel=preload; as=fetch; crossorigin`;

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
    preload("GET /workspaces/:slug/projects", slug),
    preload("GET /workspaces/:slug/labels", slug),
    preload("GET /workspaces/:slug/members", slug),
  ].join(", ");
};
