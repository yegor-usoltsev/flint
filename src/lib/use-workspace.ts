import { useParams } from "@tanstack/react-router";

import { useMe } from "~/lib/api";

export const useWorkspace = () => {
  const { slug } = useParams({ from: "/$slug" });
  const { data } = useMe();
  const workspace = data?.workspaces.find((item) => item.slug === slug);

  if (workspace === undefined) {
    throw new Error(`Workspace ${slug} is not loaded`);
  }

  return workspace;
};
