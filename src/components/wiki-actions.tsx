import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ClipboardCopyIcon,
  FilePlusIcon,
  FolderInputIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  HistoryIcon,
  LinkIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, useRef, useState } from "react";

import { MenuKeys } from "~/components/menu-filter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { WikiHistoryDialog } from "~/components/wiki-history";
import { ApiError, request, useMe } from "~/lib/api";
import type { WikiNodeKind, WikiPageSummary } from "~/lib/api-types";
import { copyText } from "~/lib/copy";
import { newId } from "~/lib/ids";
import { notifyError, notifyWithAction } from "~/lib/notify";
import { discardDraft } from "~/lib/use-draft";
import { useCommands } from "~/lib/use-hotkey";
import type { Command, Hotkey } from "~/lib/use-hotkey";
import { useWorkspace } from "~/lib/use-workspace";
import {
  buildTree,
  contentsText,
  findNode,
  inSubtree,
  moveNode,
  movedPath,
  pathPattern,
  pathProblem,
  setPage,
  slugify,
  wikiDraftId,
  wikiDraftText,
  wikiPagesQuery,
  wikiTarget,
  workspaceWiki,
} from "~/lib/wiki";
import type { Wiki } from "~/lib/wiki";

export const useCurrentWikiPath = (wiki: Wiki) => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const prefix = `/${wiki.slug}/wiki`;

  return pathname === prefix || pathname.startsWith(`${prefix}/`)
    ? decodeURIComponent(pathname.slice(prefix.length + 1)).toLowerCase()
    : null;
};

type FinalFocus = () => HTMLElement | true;

const conflictMessage = (error: Error | null, path: string) =>
  error instanceof ApiError && error.status === 409
    ? `Something already exists at ${path}`
    : error?.message;

const NodeFields = ({
  checkPath = true,
  error,
  focus = "title",
  onChange,
  path,
  placeholder,
  title,
}: {
  checkPath?: boolean;
  error?: string;
  focus?: "path" | "title";
  onChange: (change: { path?: string; title?: string }) => void;
  path: string;
  placeholder: string;
  title: string;
}) => {
  const problem = (checkPath ? pathProblem(path) : null) ?? error ?? null;

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="wiki-node-title">Title</FieldLabel>
        <Input
          autoComplete="off"
          autoFocus={focus === "title"}
          id="wiki-node-title"
          maxLength={200}
          onChange={(event) => {
            onChange({ title: event.target.value });
          }}
          placeholder="Setup guide"
          required
          value={title}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="wiki-node-path">Path</FieldLabel>
        <Input
          aria-describedby="wiki-node-path-hint"
          aria-invalid={problem !== null}
          autoComplete="off"
          autoFocus={focus === "path"}
          id="wiki-node-path"
          maxLength={200}
          onChange={(event) => {
            onChange({ path: event.target.value.toLowerCase() });
          }}
          placeholder={placeholder}
          required
          value={path}
        />
        <FieldDescription id="wiki-node-path-hint">
          Lowercase letters, digits, “.”, “_” and “-”; “/” nests it, as in
          guides/setup. Agents address it by this path; links use its permanent
          /doc address.
        </FieldDescription>
        {problem === null ? null : <FieldError>{problem}</FieldError>}
      </Field>
    </FieldGroup>
  );
};

const CreateForm = ({
  kind,
  onDone,
  parent,
  wiki,
}: {
  kind: WikiNodeKind;
  onDone: () => void;
  parent: string;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [typedPath, setTypedPath] = useState<string | null>(null);
  const prefix = parent === "" ? "" : `${parent}/`;
  const path = typedPath ?? `${prefix}${slugify(title)}`;

  const create = useMutation({
    mutationFn: async () =>
      await request("PUT /workspaces/:slug/wiki/*", {
        body: { baseRevision: 0, id: newId(), kind, title: title.trim() },
        params: { _splat: path, slug: wiki.slug },
      }),
    onSuccess: async (page) => {
      setPage(queryClient, wiki, page);
      onDone();
      await navigate(wikiTarget(wiki, page.path));
    },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <NodeFields
        checkPath={typedPath !== null || title.trim() !== ""}
        error={conflictMessage(create.error, path)}
        onChange={(change) => {
          if (change.title !== undefined) {
            setTitle(change.title);
          }

          if (change.path !== undefined) {
            setTypedPath(change.path);
          }

          create.reset();
        }}
        path={path}
        placeholder={`${prefix}setup`}
        title={title}
      />
      <DialogFooter>
        <Button
          disabled={
            create.isPending || !pathPattern.test(path) || title.trim() === ""
          }
          type="submit"
        >
          {kind === "folder" ? "Create folder" : "Create page"}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const CreateNodeDialog = ({
  finalFocus,
  kind,
  onOpenChange,
  open,
  parent = "",
  wiki,
}: {
  finalFocus?: FinalFocus;
  kind: WikiNodeKind;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  parent?: string;
  wiki: Wiki;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="wrap-anywhere" finalFocus={finalFocus}>
      <DialogHeader>
        <DialogTitle>
          {kind === "folder" ? "New folder" : "New page"}
          {parent === "" ? null : ` in ${parent}`}
        </DialogTitle>
        <DialogDescription>{wiki.name} wiki</DialogDescription>
      </DialogHeader>
      <CreateForm
        kind={kind}
        onDone={() => {
          onOpenChange(false);
        }}
        parent={parent}
        wiki={wiki}
      />
    </DialogContent>
  </Dialog>
);

const RenameForm = ({
  focus,
  node,
  onDone,
  wiki,
}: {
  focus: "path" | "title";
  node: WikiPageSummary;
  onDone: () => void;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useCurrentWikiPath(wiki);
  // oxlint-disable-next-line react-doctor/no-derived-useState -- The form mounts each time the dialog opens and edits from the node's values then.
  const [title, setTitle] = useState(node.title);
  // oxlint-disable-next-line react-doctor/no-derived-useState -- See the title above.
  const [path, setPath] = useState(node.path);

  const save = useMutation({
    mutationFn: async () => {
      const moved =
        path === node.path
          ? node
          : await moveNode(queryClient, wiki, node, path);

      if (title.trim() !== node.title) {
        setPage(
          queryClient,
          wiki,
          await request("PATCH /workspaces/:slug/wiki/*", {
            body: {
              baseRevision: moved.revision,
              id: node.id,
              title: title.trim(),
            },
            params: { _splat: moved.path, slug: wiki.slug },
          })
        );
      }

      return moved;
    },
    onSuccess: async (page) => {
      onDone();

      if (current !== null && inSubtree(current, node.path)) {
        await navigate({
          ...wikiTarget(wiki, movedPath(current, node.path, page.path)),
          replace: true,
        });
      }
    },
  });

  const unchanged = path === node.path && title.trim() === node.title;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <NodeFields
        error={conflictMessage(save.error, path)}
        focus={focus}
        onChange={(change) => {
          if (change.title !== undefined) {
            setTitle(change.title);
          }

          if (change.path !== undefined) {
            setPath(change.path);
          }

          save.reset();
        }}
        path={path}
        placeholder={node.path}
        title={title}
      />
      <DialogFooter>
        <Button
          disabled={
            save.isPending ||
            unchanged ||
            !pathPattern.test(path) ||
            title.trim() === ""
          }
          type="submit"
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
};

const RenameDialog = ({
  finalFocus,
  focus,
  node,
  onOpenChange,
  open,
  wiki,
}: {
  finalFocus: FinalFocus;
  focus: "path" | "title";
  node: WikiPageSummary;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  wiki: Wiki;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="wrap-anywhere" finalFocus={finalFocus}>
      <DialogHeader>
        <DialogTitle>Rename or move {node.title}</DialogTitle>
        <DialogDescription>
          A new path moves everything inside it too. Old paths stop working;
          links to /doc addresses keep working.
        </DialogDescription>
      </DialogHeader>
      <RenameForm
        focus={focus}
        node={node}
        onDone={() => {
          onOpenChange(false);
        }}
        wiki={wiki}
      />
    </DialogContent>
  </Dialog>
);

const DeleteDialog = ({
  finalFocus,
  node,
  onOpenChange,
  open,
  wiki,
}: {
  finalFocus: FinalFocus;
  node: WikiPageSummary;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useCurrentWikiPath(wiki);
  const pages = useQuery(wikiPagesQuery(wiki));
  const trashDays = useMe().data?.trashDays;

  const nested = contentsText(
    findNode(buildTree(pages.data ?? []), node.path)?.children ?? []
  );

  const restore = async () => {
    const page = await request("POST /wiki/:pageId/restore", {
      params: { pageId: node.id },
    });

    await queryClient.invalidateQueries({
      queryKey: wikiPagesQuery(wiki).queryKey,
    });
    await navigate(wikiTarget(wiki, page.path));
  };

  const remove = useMutation({
    mutationFn: async () => {
      await request("DELETE /wiki/:pageId", { params: { pageId: node.id } });
    },
    onError: notifyError(`Could not delete ${node.title}`),
    onSuccess: async () => {
      discardDraft(`${wikiDraftId(node.id)}:title`);
      discardDraft(`${wikiDraftId(node.id)}:body`);
      notifyWithAction({
        action: "Undo",
        onAction: () => {
          restore().catch(notifyError(`Could not restore ${node.title}`));
        },
        title: `Moved ${node.title} to the trash`,
      });

      if (current !== null && inSubtree(current, node.path)) {
        await navigate(wikiTarget(wiki, ""));
      }

      queryClient.removeQueries({
        predicate: (query) => inSubtree(String(query.queryKey[3]), node.path),
        queryKey: ["wiki", wiki.key, "page"],
      });
      await queryClient.invalidateQueries({
        queryKey: wikiPagesQuery(wiki).queryKey,
      });
    },
  });

  const kind = node.kind === "folder" ? "folder" : "page";

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent className="wrap-anywhere" finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {node.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {nested === ""
              ? `The ${kind} moves to the trash for everyone. It can be restored for ${trashDays} days.`
              : `The ${kind} and the ${nested} inside it move to the trash for everyone. They can be restored for ${trashDays} days.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              remove.mutate();
            }}
            variant="destructive"
          >
            Delete {kind}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface NodeCommand {
  command: string;
  hotkey?: Hotkey;
  icon: LucideIcon;
  id: string;
  label: string;
  run: () => void;
}

const act = {
  delete: "delete",
  history: "history",
  move: "move",
  newFolder: "new-folder",
  newPage: "new-page",
  rename: "rename",
} as const;

const copy = (text: string, what: string) => () => {
  void copyText(text, what);
};

const savedBody = async (pageId: string) => {
  const page = await request("GET /wiki/:pageId", { params: { pageId } });

  return page.body;
};

const copyMarkdown = async (node: WikiPageSummary) => {
  const body = wikiDraftText(node.id, "body") ?? (await savedBody(node.id));

  await copyText(body, "page as Markdown");
};

export const useNodeActions = (
  wiki: Wiki,
  node: WikiPageSummary,
  { shortcuts = false }: { shortcuts?: boolean } = {}
) => {
  const [action, setAction] = useState<string | null>(null);
  const kind = node.kind === "folder" ? "folder" : "page";
  const page = node.kind === "page";

  const returnTo = useRef<Element | null>(null);

  const finalFocus = () => {
    const target = returnTo.current;

    returnTo.current = null;

    return target instanceof HTMLElement && target.isConnected ? target : true;
  };

  const dialog = (...names: string[]) => ({
    finalFocus,
    onOpenChange: (open: boolean) => {
      setAction(open ? (names[0] ?? null) : null);
    },
    open: action !== null && names.includes(action),
    wiki,
  });

  const opener = (name: string) => () => {
    setAction(name);
  };

  const create: NodeCommand[] = [
    {
      command: page ? "Create subpage" : "Create page in this folder",
      icon: FilePlusIcon,
      id: act.newPage,
      label: page ? "New subpage" : "New page",
      run: opener(act.newPage),
    },
  ];

  if (!page) {
    create.push({
      command: "Create folder in this folder",
      icon: FolderPlusIcon,
      id: act.newFolder,
      label: "New folder",
      run: opener(act.newFolder),
    });
  }

  const edit: NodeCommand[] = [
    {
      command: `Rename ${kind}`,
      hotkey: { keys: "r", shift: true },
      icon: PencilIcon,
      id: act.rename,
      label: "Rename…",
      run: opener(act.rename),
    },
    {
      command: `Move ${kind}…`,
      hotkey: { keys: "p", shift: true },
      icon: FolderInputIcon,
      id: act.move,
      label: "Move…",
      run: opener(act.move),
    },
  ];

  const copies: NodeCommand[] = [
    {
      command: `Copy ${kind} link`,
      hotkey: { keys: ",", mod: true, shift: true },
      icon: LinkIcon,
      id: "copy-link",
      label: "Copy link",
      run: copy(`${location.origin}/doc/${node.id}`, "link"),
    },
    {
      command: `Copy ${kind} title`,
      hotkey: { keys: "'", mod: true, shift: true },
      icon: TypeIcon,
      id: "copy-title",
      label: "Copy title",
      run: () => {
        void copyText(wikiDraftText(node.id, "title") ?? node.title, "title");
      },
    },
    {
      command: `Copy ${kind} path`,
      icon: FolderTreeIcon,
      id: "copy-path",
      label: "Copy path",
      run: copy(node.path, "path"),
    },
  ];

  if (page) {
    edit.push({
      command: "Show page history",
      icon: HistoryIcon,
      id: act.history,
      label: "Show history",
      run: opener(act.history),
    });
    copies.push({
      command: "Copy page as Markdown",
      icon: ClipboardCopyIcon,
      id: "copy-markdown",
      label: "Copy as Markdown",
      run: () => {
        copyMarkdown(node).catch(notifyError("Could not copy the page"));
      },
    });
  }

  const groups = [
    create,
    edit,
    copies,
    [
      {
        command: `Delete ${kind}`,
        hotkey: { keys: "backspace", mod: true },
        icon: Trash2Icon,
        id: act.delete,
        label: "Delete…",
        run: opener(act.delete),
      },
    ],
  ];

  const dialogs = (
    <>
      <CreateNodeDialog
        {...dialog(act.newPage)}
        kind="page"
        parent={node.path}
      />
      <CreateNodeDialog
        {...dialog(act.newFolder)}
        kind="folder"
        parent={node.path}
      />
      {action === act.rename || action === act.move ? (
        <RenameDialog
          {...dialog(act.rename, act.move)}
          focus={action === act.move ? "path" : "title"}
          node={node}
        />
      ) : null}
      <DeleteDialog {...dialog(act.delete)} node={node} />
      {page ? (
        <WikiHistoryDialog {...dialog(act.history)} pageId={node.id} />
      ) : null}
    </>
  );

  const items = groups.map((group, index) => (
    <Fragment key={group[0]?.id}>
      {index === 0 ? null : <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {group.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onClick={() => {
              returnTo.current = null;
              entry.run();
            }}
            variant={entry.id === act.delete ? "destructive" : "default"}
          >
            <entry.icon />
            {entry.label}
            {shortcuts && entry.hotkey !== undefined ? (
              <MenuKeys hotkey={entry.hotkey} />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </Fragment>
  ));

  const commands = groups.flat().map((entry): Command => ({
    group: "Page",
    hotkey: entry.hotkey,
    id: `wiki-${entry.id}`,
    label: entry.command,
    run: () => {
      returnTo.current = document.activeElement;
      entry.run();
    },
  }));

  return { commands, dialogs, items, open: setAction };
};

export const WikiCreateCommands = () => {
  const workspace = useWorkspace();
  const [kind, setKind] = useState<WikiNodeKind | null>(null);

  useCommands([
    {
      group: "Create",
      id: "wiki-create-page",
      label: "Create wiki page",
      run: () => {
        setKind("page");
      },
    },
    {
      group: "Create",
      id: "wiki-create-folder",
      label: "Create wiki folder",
      run: () => {
        setKind("folder");
      },
    },
  ]);

  return (
    <CreateNodeDialog
      kind={kind ?? "page"}
      onOpenChange={(open) => {
        setKind(open ? kind : null);
      }}
      open={kind !== null}
      wiki={workspaceWiki(workspace)}
    />
  );
};
