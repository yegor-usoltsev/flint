import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderPlusIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "~/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { CreateNodeDialog, useNodeActions } from "~/components/wiki-actions";
import { NodeIcon, useWikiDrag, WikiDragDrop } from "~/components/wiki-dnd";
import {
  buildTree,
  revealPath,
  setFolderOpen,
  useOpenFolders,
  wikiPagesQuery,
  wikiTarget,
} from "~/lib/wiki";
import type { Wiki, WikiNode } from "~/lib/wiki";

const TreeRow = (props: ComponentProps<"div">) => (
  <div
    {...props}
    className="peer/row group/row data-popup-open:bg-sidebar-accent data-[drop=inside]:bg-sidebar-accent data-[drop=inside]:ring-sidebar-ring relative rounded-md data-dragging:opacity-50 data-[drop=inside]:ring-1"
  />
);

const RowButton = (props: ComponentProps<"button">) => (
  <button
    {...props}
    className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring hit-area absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm opacity-0 outline-none peer-focus-within/row:opacity-100 peer-hover/row:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 data-popup-open:opacity-100 max-md:top-3 max-md:opacity-100"
    type="button"
  />
);

const RowActions = ({
  node,
  page,
  wiki,
}: {
  node: WikiNode;
  page: NonNullable<WikiNode["page"]>;
  wiki: Wiki;
}) => {
  const actions = useNodeActions(wiki, page);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<RowButton aria-label={`${node.title} actions`} />}
        >
          <EllipsisIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {actions.items}
        </DropdownMenuContent>
      </DropdownMenu>
      <ContextMenuContent aria-label={`${node.title} actions`} className="w-52">
        {actions.items}
      </ContextMenuContent>
      {actions.dialogs}
    </>
  );
};

const RowMenu = ({ node, wiki }: { node: WikiNode; wiki: Wiki }) => {
  const { page } = node;

  if (page === undefined) {
    return null;
  }

  return <RowActions node={node} page={page} wiki={wiki} />;
};

const maxIndent = 4;

const truncated = (element: HTMLElement | null) =>
  element !== null && element.scrollWidth > element.clientWidth;

const TreeItem = ({
  depth = 0,
  expanded,
  node,
  wiki,
}: {
  depth?: number;
  expanded: Set<string>;
  node: WikiNode;
  wiki: Wiki;
}) => {
  const parent = node.children.length > 0;
  const open = expanded.has(node.path);

  const { dragging, handleRef, row, zone } = useWikiDrag<HTMLDivElement>(node);
  const label = useRef<HTMLSpanElement>(null);
  const [hint, setHint] = useState(false);

  return (
    <SidebarMenuSubItem>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <TreeRow
              data-dragging={dragging ? "" : undefined}
              data-drop={zone ?? undefined}
              ref={row}
            />
          }
        >
          <Tooltip
            onOpenChange={(next) => {
              setHint(next && truncated(label.current));
            }}
            open={hint}
          >
            <TooltipTrigger
              render={
                <SidebarMenuSubButton
                  render={
                    <Link
                      activeOptions={{ exact: true }}
                      ref={handleRef}
                      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The element is an a; dnd-kit gives a drag handle without an explicit role the button role.
                      role="link"
                      {...wikiTarget(wiki, node.path)}
                    />
                  }
                />
              }
            >
              {parent ? (
                <span aria-hidden className="size-4 shrink-0" />
              ) : (
                <NodeIcon node={node} />
              )}
              <span
                className={cn(
                  "group-focus-within/row:pr-5 group-hover/row:pr-5 group-data-popup-open/row:pr-5 max-md:pr-5",
                  node.page === undefined && "text-muted-foreground"
                )}
                ref={label}
              >
                {node.title}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{node.title}</TooltipContent>
          </Tooltip>
          {parent ? (
            <button
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring hit-area absolute top-1 left-1.5 flex size-5 items-center justify-center rounded-sm outline-none focus-visible:ring-2 max-md:top-3"
              onClick={() => {
                setFolderOpen(wiki, node.path, !open);
              }}
              type="button"
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  open && "rotate-90"
                )}
              />
            </button>
          ) : null}
          {zone === "before" || zone === "after" ? (
            <span
              aria-hidden
              className={cn(
                "bg-primary pointer-events-none absolute inset-x-1 h-0.5 rounded-full",
                zone === "before" ? "-top-0.5" : "-bottom-0.5"
              )}
            />
          ) : null}
        </ContextMenuTrigger>
        <RowMenu node={node} wiki={wiki} />
      </ContextMenu>
      {parent && open ? (
        <ul
          className={cn(
            "mt-1 flex flex-col gap-1",
            depth < maxIndent && "pl-2"
          )}
        >
          {node.children.map((child) => (
            <TreeItem
              depth={depth + 1}
              expanded={expanded}
              key={child.path}
              node={child}
              wiki={wiki}
            />
          ))}
        </ul>
      ) : null}
    </SidebarMenuSubItem>
  );
};

export const WikiTree = ({
  current,
  wiki,
}: {
  current: string;
  wiki: Wiki;
}) => {
  const pages = useQuery(wikiPagesQuery(wiki));
  const [creating, setCreating] = useState<"folder" | "page" | null>(null);
  const tree = buildTree(pages.data ?? []);
  const list = useRef<HTMLUListElement>(null);
  const { openMobile } = useSidebar();
  const expanded = useOpenFolders(wiki, current);

  useLayoutEffect(() => {
    revealPath(wiki, current);
  }, [current, wiki]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (openMobile) {
        list.current
          ?.querySelector('[aria-current="page"]')
          ?.scrollIntoView({ block: "center" });
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [openMobile]);

  return (
    <WikiDragDrop tree={tree} wiki={wiki}>
      <SidebarMenuSub
        aria-label={`${wiki.name} wiki pages`}
        className="-mr-2.5"
        ref={list}
      >
        {tree.map((node) => (
          <TreeItem
            expanded={expanded}
            key={node.path}
            node={node}
            wiki={wiki}
          />
        ))}
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            render={<button aria-label="New page" type="button" />}
            onClick={() => {
              setCreating("page");
            }}
          >
            <PlusIcon />
            <span className="text-muted-foreground">New page</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            render={<button aria-label="New folder" type="button" />}
            onClick={() => {
              setCreating("folder");
            }}
          >
            <FolderPlusIcon />
            <span className="text-muted-foreground">New folder</span>
          </SidebarMenuSubButton>
          <CreateNodeDialog
            kind={creating ?? "page"}
            onOpenChange={(next) => {
              setCreating(next ? creating : null);
            }}
            open={creating !== null}
            wiki={wiki}
          />
        </SidebarMenuSubItem>
      </SidebarMenuSub>
    </WikiDragDrop>
  );
};
