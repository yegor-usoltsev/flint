import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookOpenIcon,
  CheckIcon,
  CircleDotIcon,
  FileTextIcon,
  FolderIcon,
} from "lucide-react";

import { ProjectIcon } from "~/components/project-icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { projectsQuery } from "~/lib/queries";
import { useWorkspace } from "~/lib/use-workspace";
import {
  buildTree,
  wikiPagesQuery,
  wikiTarget,
  workspaceWiki,
} from "~/lib/wiki";
import type { WikiNode } from "~/lib/wiki";

export type SwitcherPlace =
  | { kind: "mine" }
  | { kind: "project"; key: string }
  | { kind: "wiki"; path: string };

const flatten = (nodes: WikiNode[], depth = 0): [WikiNode, number][] =>
  nodes.flatMap((node): [WikiNode, number][] => [
    [node, depth],
    ...flatten(node.children, depth + 1),
  ]);

const Here = ({ shown }: { shown: boolean }) => {
  if (!shown) {
    return null;
  }

  return <CheckIcon aria-label="Current" className="ml-auto" />;
};

const WikiPages = ({ path }: { path: string }) => {
  const workspace = useWorkspace();
  const wiki = workspaceWiki(workspace);
  const pages = useQuery(wikiPagesQuery(wiki));
  const rows = flatten(buildTree(pages.data ?? []));

  if (rows.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Pages</DropdownMenuLabel>
        {rows.map(([node, depth]) => (
          <DropdownMenuItem
            key={node.path}
            render={<Link {...wikiTarget(wiki, node.path)} />}
          >
            {depth === 0 ? null : (
              <span
                aria-hidden
                className="-mr-1.5 w-(--depth) shrink-0"
                style={{ "--depth": `${Math.min(depth, 3) * 1.25}rem` }}
              />
            )}
            {node.page?.kind === "folder" ? <FolderIcon /> : <FileTextIcon />}
            <span className="truncate">{node.title}</span>
            <Here shown={node.path === path} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
};

export const NavSwitcher = ({ place }: { place: SwitcherPlace }) => {
  const workspace = useWorkspace();
  const projects = useQuery(projectsQuery(workspace.slug));
  const { slug } = workspace;

  return (
    <>
      {place.kind === "wiki" ? <WikiPages path={place.path} /> : null}
      <DropdownMenuGroup>
        <DropdownMenuItem
          render={<Link params={{ slug }} to="/$slug/my-issues" />}
        >
          <CircleDotIcon />
          My issues
          <Here shown={place.kind === "mine"} />
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link {...wikiTarget(workspaceWiki(workspace), "")} />}
        >
          <BookOpenIcon />
          Wiki
          <Here shown={place.kind === "wiki" && place.path === ""} />
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {projects.data === undefined || projects.data.length === 0 ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects.data.map((project) => (
              <DropdownMenuItem
                key={project.id}
                render={
                  <Link
                    params={{ key: project.key, slug }}
                    to="/$slug/project/$key"
                  />
                }
              >
                <ProjectIcon color={project.color} icon={project.icon} />
                <span className="truncate">{project.name}</span>
                <Here
                  shown={place.kind === "project" && place.key === project.key}
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
};
