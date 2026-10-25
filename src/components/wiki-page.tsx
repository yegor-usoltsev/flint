import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowDownUpIcon,
  BookOpenIcon,
  CodeXmlIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  LinkIcon,
  PlusIcon,
  TriangleAlertIcon,
  TypeIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactElement } from "react";

import { ConflictDialog, SaveState } from "~/components/conflict-dialog";
import { AttachmentList } from "~/components/issue-attachments";
import { Hint } from "~/components/issue-parts";
import { LoadFailed } from "~/components/load-failed";
import {
  AttachButton,
  MarkdownEditor,
  SourceToggle,
} from "~/components/markdown-editor";
import type { MarkdownEditorHandle } from "~/components/markdown-editor";
import { Page } from "~/components/page";
import type { Crumb } from "~/components/page";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { toast } from "~/components/ui/toast";
import { UserAvatar } from "~/components/user-avatar";
import { CreateNodeDialog, useNodeActions } from "~/components/wiki-actions";
import { useWikiDrag, WikiDragDrop } from "~/components/wiki-dnd";
import { useMediaQuery } from "~/hooks/use-media-query";
import { ApiError, request } from "~/lib/api";
import type { WikiNodeKind, WikiPage, WikiPageSummary } from "~/lib/api-types";
import { copyText } from "~/lib/copy";
import { newId } from "~/lib/ids";
import { formatRelative } from "~/lib/issue-view";
import { notifyError } from "~/lib/notify";
import { usePageTitle } from "~/lib/site";
import { discardDraft, useDraft, useHasDraft } from "~/lib/use-draft";
import type { DraftWrite } from "~/lib/use-draft";
import { useCommands } from "~/lib/use-hotkey";
import { useWorkspace } from "~/lib/use-workspace";
import {
  ancestors,
  buildTree,
  findNode,
  humanize,
  keptKey,
  missingState,
  nextKept,
  readKept,
  recentPages,
  rememberWikiSort,
  saveAsNewPage,
  setPage,
  storeKept,
  useWikiSort,
  wikiDraftId,
  wikiDraftKeys,
  wikiPageQuery,
  wikiPagesQuery,
  wikiTarget,
  workspaceWiki,
  writePage,
} from "~/lib/wiki";
import type { KeptState, Wiki, WikiNode } from "~/lib/wiki";
import { headingsOf } from "~/lib/wiki-headings";
import type { Heading } from "~/lib/wiki-headings";

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const createPage = async (
  wiki: Wiki,
  path: string,
  content: { body: string; title: string },
  id = newId()
) =>
  await request("PUT /workspaces/:slug/wiki/*", {
    body: { ...content, baseRevision: 0, id },
    params: { _splat: path, slug: wiki.slug },
  });

const NodeIcon = ({ kind }: { kind?: WikiNodeKind }) => {
  const Icon = kind === "page" ? FileTextIcon : FolderIcon;

  return <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />;
};

const NodeMenu = ({
  children,
  node,
  wiki,
}: {
  children: ReactElement;
  node: WikiPageSummary;
  wiki: Wiki;
}) => {
  const actions = useNodeActions(wiki, node);

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent aria-label={`${node.title} actions`} className="w-52">
        {actions.items}
      </ContextMenuContent>
      {actions.dialogs}
    </ContextMenu>
  );
};

const RowFrame = (props: ComponentProps<"div">) => (
  <div
    {...props}
    className="data-popup-open:bg-row-focus data-[drop=inside]:bg-row-focus data-[drop=inside]:ring-ring relative rounded-md data-dragging:opacity-50 data-[drop=inside]:ring-1"
  />
);

const RowLink = ({
  node,
  wiki,
  ...props
}: ComponentProps<"a"> & { node: WikiNode; wiki: Wiki }) => (
  <Link
    {...props}
    {...wikiTarget(wiki, node.path)}
    className="hover:bg-row-focus focus-visible:bg-row-focus flex h-11 min-w-0 items-center gap-3 rounded-md px-2 outline-none"
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The element is an a; dnd-kit gives a drag handle without an explicit role the button role.
    role="link"
  >
    <NodeIcon kind={node.page?.kind} />
    <span className="truncate">{node.title}</span>
    <span className="text-muted-foreground hidden truncate font-mono text-xs sm:inline">
      {node.path}
    </span>
    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
      {node.page?.kind === "page"
        ? formatRelative(node.page.updatedAt)
        : "Folder"}
    </span>
  </Link>
);

const IndexRow = ({ node, wiki }: { node: WikiNode; wiki: Wiki }) => {
  const { dragging, handleRef, row, zone } = useWikiDrag<HTMLDivElement>(node);

  const frame = (
    <RowFrame
      data-dragging={dragging ? "" : undefined}
      data-drop={zone ?? undefined}
      ref={row}
    >
      <RowLink node={node} ref={handleRef} wiki={wiki} />
      {zone === "before" || zone === "after" ? (
        <span
          aria-hidden
          className={cn(
            "bg-primary pointer-events-none absolute inset-x-1 h-0.5 rounded-full",
            zone === "before" ? "-top-px" : "-bottom-px"
          )}
        />
      ) : null}
    </RowFrame>
  );

  if (node.page === undefined) {
    return frame;
  }

  return (
    <NodeMenu node={node.page} wiki={wiki}>
      {frame}
    </NodeMenu>
  );
};

const PageRows = ({
  label,
  nodes,
  wiki,
}: {
  label?: string;
  nodes: WikiNode[];
  wiki: Wiki;
}) => (
  <ul aria-label={label} className={cn(label === undefined ? "pl-5" : "p-2")}>
    {nodes.map((node) => (
      <li key={node.path}>
        <IndexRow node={node} wiki={wiki} />
        {node.children.length === 0 ? null : (
          <PageRows nodes={node.children} wiki={wiki} />
        )}
      </li>
    ))}
  </ul>
);

const RecentRows = ({
  pages,
  wiki,
}: {
  pages: WikiPageSummary[];
  wiki: Wiki;
}) => (
  <ul aria-label="Pages" className="p-2">
    {pages.map((page) => (
      <li key={page.id}>
        <NodeMenu node={page} wiki={wiki}>
          <RowFrame>
            <RowLink
              node={{ children: [], page, path: page.path, title: page.title }}
              wiki={wiki}
            />
          </RowFrame>
        </NodeMenu>
      </li>
    ))}
  </ul>
);

const SortMenu = () => {
  const sort = useWikiSort();

  return (
    <DropdownMenu>
      <Hint label="Sort">
        <DropdownMenuTrigger
          render={
            <Button aria-label="Sort" size="icon-round" variant="ghost" />
          }
        >
          <ArrowDownUpIcon />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            rememberWikiSort(value === "edited" ? "edited" : "manual");
          }}
          value={sort}
        >
          <DropdownMenuRadioItem value="manual">
            Manual order
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="edited">
            Last edited
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const PageMenu = ({
  actions,
}: {
  actions: ReturnType<typeof useNodeActions>;
}) => (
  <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label="Page actions" size="icon-sm" variant="ghost" />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {actions.items}
      </DropdownMenuContent>
    </DropdownMenu>
    {actions.dialogs}
  </>
);

const useCreate = (wiki: Wiki, parent: string) => {
  const [kind, setKind] = useState<WikiNodeKind | null>(null);

  const buttons = (
    <>
      <SortMenu />
      <Hint label="New folder">
        <Button
          aria-label="New folder"
          onClick={() => {
            setKind("folder");
          }}
          size="icon-round"
          variant="ghost"
        >
          <FolderPlusIcon />
        </Button>
      </Hint>
      <Button
        className="max-md:hidden"
        onClick={() => {
          setKind("page");
        }}
        size="pill"
        variant="ghost"
      >
        <PlusIcon data-icon="inline-start" />
        New page
      </Button>
      <Button
        aria-label="New page"
        className="md:hidden"
        onClick={() => {
          setKind("page");
        }}
        size="icon-round"
        variant="ghost"
      >
        <PlusIcon />
      </Button>
      <CreateNodeDialog
        kind={kind ?? "page"}
        onOpenChange={(open) => {
          setKind(open ? kind : null);
        }}
        open={kind !== null}
        parent={parent}
        wiki={wiki}
      />
    </>
  );

  const create = (next: WikiNodeKind) => () => {
    setKind(next);
  };

  return {
    buttons,
    create: create("page"),
  };
};

const NodeList = ({
  create,
  folder,
  wiki,
}: {
  create: () => void;
  folder: string;
  wiki: Wiki;
}) => {
  const pages = useQuery(wikiPagesQuery(wiki));
  const sort = useWikiSort();
  const tree = buildTree(pages.data ?? []);
  const nodes = folder === "" ? tree : (findNode(tree, folder)?.children ?? []);
  const recent = sort === "edited" ? recentPages(pages.data ?? [], folder) : [];

  if (pages.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (pages.isError && pages.data === undefined) {
    return (
      <LoadFailed
        className="m-4"
        error={pages.error}
        onRetry={() => {
          void pages.refetch();
        }}
        title="Pages could not load"
      />
    );
  }

  if (recent.length > 0) {
    return <RecentRows pages={recent} wiki={wiki} />;
  }

  if (nodes.length > 0) {
    return (
      <WikiDragDrop tree={tree} wiki={wiki}>
        <PageRows label="Pages" nodes={nodes} wiki={wiki} />
      </WikiDragDrop>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {folder === "" ? <BookOpenIcon /> : <FolderIcon />}
        </EmptyMedia>
        <EmptyTitle>
          <h2>{folder === "" ? "No pages yet" : "This folder is empty"}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {folder === ""
            ? `Notes, decisions and how-tos for ${wiki.name} live here.`
            : "Pages and folders created here appear in this list."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={create}>
          <PlusIcon data-icon="inline-start" />
          {folder === "" ? "Create the first page" : "Create a page"}
        </Button>
      </EmptyContent>
    </Empty>
  );
};

const WikiIndex = ({ crumbs, wiki }: { crumbs: Crumb[]; wiki: Wiki }) => {
  const { buttons, create } = useCreate(wiki, "");

  return (
    <Page actions={buttons} crumbs={crumbs} title="Wiki">
      <NodeList create={create} folder="" wiki={wiki} />
    </Page>
  );
};

const FolderView = ({
  crumbs,
  folder,
  wiki,
}: {
  crumbs: Crumb[];
  folder: WikiPage;
  wiki: Wiki;
}) => {
  const { buttons, create } = useCreate(wiki, folder.path);
  const actions = useNodeActions(wiki, folder, { shortcuts: true });

  useCommands(actions.commands);

  return (
    <Page
      actions={
        <>
          {buttons}
          <PageMenu actions={actions} />
        </>
      }
      crumbs={crumbs}
      title={folder.title}
    >
      <NodeList create={create} folder={folder.path} wiki={wiki} />
    </Page>
  );
};

const headingIndent = ["pl-2", "pl-2", "pl-5", "pl-8"];

const Contents = ({
  headings,
  onJump,
}: {
  headings: Heading[];
  onJump: (index: number) => void;
}) => (
  <nav aria-label="On this page" className="flex flex-col gap-1">
    <h2 className="text-muted-foreground px-2 text-xs font-medium">
      On this page
    </h2>
    <ul className="flex flex-col">
      {headings.map((heading, index) => (
        <li key={heading.id}>
          <button
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring w-full truncate rounded-md py-1 pr-2 text-left outline-none focus-visible:ring-2",
              headingIndent[heading.level]
            )}
            onClick={() => {
              onJump(index);
            }}
            type="button"
          >
            {heading.text}
          </button>
        </li>
      ))}
    </ul>
  </nav>
);

const DeletedBanner = ({
  onRestore,
  path,
  pending,
}: {
  onRestore: () => void;
  path: string;
  pending: boolean;
}) => (
  <Alert className="mb-3 wrap-anywhere" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>This page was deleted</AlertTitle>
    <AlertDescription>
      Someone moved {path} to the trash while it was open. Your text is still
      here; restoring the page saves it.
    </AlertDescription>
    <AlertAction>
      <Button
        disabled={pending}
        onClick={onRestore}
        size="sm"
        variant="outline"
      >
        Restore page
      </Button>
    </AlertAction>
  </Alert>
);

const ReplacedBanner = ({
  onCopy,
  onOpen,
  onSaveAs,
  path,
  pending,
  replacement,
}: {
  onCopy: () => void;
  onOpen: () => void;
  onSaveAs: () => void;
  path: string;
  pending: boolean;
  replacement: string;
}) => (
  <Alert className="mb-3 wrap-anywhere" variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>Another page now uses this path</AlertTitle>
    <AlertDescription>
      Someone deleted this page and created “{replacement}” at {path}. Your text
      is still here and is not saved.
    </AlertDescription>
    <div className="col-start-2 mt-2 flex flex-wrap gap-2">
      <Button onClick={onCopy} size="sm" variant="outline">
        Copy text
      </Button>
      <Button disabled={pending} onClick={onSaveAs} size="sm" variant="outline">
        Save as a new page
      </Button>
      <Button onClick={onOpen} size="sm" variant="outline">
        Open the new page
      </Button>
    </div>
  </Alert>
);

const PageTitle = ({
  autosave,
  draft,
  onDone,
  readOnly,
}: {
  autosave: boolean;
  draft: Pick<
    ReturnType<typeof useDraft>,
    "handleChange" | "handleDiscard" | "handleFlush" | "value"
  >;
  onDone: () => void;
  readOnly: boolean;
}) => (
  <textarea
    aria-label="Page title"
    className="placeholder:text-muted-foreground text-title field-sizing-content w-full resize-none bg-transparent outline-none"
    onBlur={() => {
      if (draft.value.trim() === "") {
        draft.handleDiscard();
        toast.add({
          description: "The page keeps its saved title.",
          title: "A title is required",
          type: "error",
        });
      } else if (autosave) {
        draft.handleFlush();
      }
    }}
    onChange={(event) => {
      draft.handleChange(event.target.value.replaceAll("\n", " "));
    }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        onDone();
      } else if (event.key === "Escape") {
        draft.handleDiscard();
      }
    }}
    placeholder="Untitled"
    readOnly={readOnly}
    rows={1}
    value={draft.value}
  />
);

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const EditedButton = ({
  onHistory,
  page,
}: {
  onHistory: () => void;
  page: WikiPage;
}) => (
  <Popover>
    <PopoverTrigger
      render={<Button className="max-md:hidden" size="pill" variant="ghost" />}
    >
      <span className="text-muted-foreground font-normal">
        Edited {formatRelative(page.updatedAt)}
      </span>
    </PopoverTrigger>
    <PopoverContent aria-label="Page edits" align="end" className="w-72">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Last edit by</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <UserAvatar
            avatarUrl={page.updatedBy.avatarUrl}
            className="size-5"
            name={page.updatedBy.displayName}
          />
          <span className="truncate">{page.updatedBy.displayName}</span>
        </dd>
        <dt className="text-muted-foreground">Edited</dt>
        <dd>{dateTime.format(new Date(page.updatedAt))}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>{dateTime.format(new Date(page.createdAt))}</dd>
      </dl>
      <Button onClick={onHistory} size="sm" variant="outline">
        <HistoryIcon data-icon="inline-start" />
        Show history
      </Button>
    </PopoverContent>
  </Popover>
);

const SourceIconToggle = ({
  onChange,
  source,
}: {
  onChange: (source: boolean) => void;
  source: boolean;
}) => {
  const label = source ? "Show formatted page" : "Show Markdown";

  return (
    <Hint label={label}>
      <Button
        aria-label={label}
        className="md:hidden"
        onClick={() => {
          onChange(!source);
        }}
        size="icon-sm"
        variant="ghost"
      >
        {source ? <TypeIcon /> : <CodeXmlIcon />}
      </Button>
    </Hint>
  );
};

const CopyLinkButton = ({ id }: { id: string }) => (
  <Hint label="Copy link">
    <Button
      aria-label="Copy link"
      className="max-md:hidden"
      onClick={() => {
        void copyText(`${location.origin}/doc/${id}`, "link");
      }}
      size="icon-sm"
      variant="ghost"
    >
      <LinkIcon />
    </Button>
  </Hint>
);

const PageEditor = ({
  crumbs,
  deleted,
  lookupError,
  onRelease,
  onRetryLookup,
  page,
  replacement,
  wiki,
}: {
  crumbs: Crumb[];
  deleted: boolean;
  lookupError: Error | null;
  onRelease: () => void;
  onRetryLookup: () => void;
  page: WikiPage;
  replacement: WikiPage | null;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rail = useMediaQuery("(min-width: 1280px)");
  const [source, setSource] = useState(false);
  const actions = useNodeActions(wiki, page, { shortcuts: true });
  const editor = useRef<MarkdownEditorHandle>(null);
  const bodyBox = useRef<HTMLDivElement>(null);

  const write =
    (field: "body" | "title") =>
    (current: WikiPage, text: string, options: DraftWrite<WikiPage>) => {
      writePage(queryClient, wiki, current, field, text, options);
    };

  const draftId = wikiDraftId(page.id);

  const title = useDraft(draftId, page, "title", null, {
    name: page.path,
    write: write("title"),
  });

  const body = useDraft(draftId, page, "body", deleted ? null : 600, {
    label: "text",
    name: page.path,
    write: write("body"),
  });

  const statuses = [title.status, body.status];

  const status =
    ["error", "saving", "pending", "conflict"].find((value) =>
      statuses.some((item) => item === value)
    ) ?? "saved";

  const save = () => {
    if (deleted) {
      return;
    }

    if (title.value.trim() !== "") {
      title.handleFlush();
    }

    body.handleFlush();
  };

  useCommands([
    {
      group: "Page",
      hotkey: { inInputs: true, keys: "s", mod: true },
      id: "wiki-save",
      label: "Save page",
      run: save,
    },
    {
      group: "Page",
      id: "wiki-source",
      label: source ? "Show formatted page" : "Show page Markdown",
      run: () => {
        setSource(!source);
      },
    },
    ...actions.commands,
  ]);

  const headingElements = () =>
    [
      ...(bodyBox.current?.querySelectorAll(".markdown :is(h1, h2, h3)") ?? []),
    ].filter((element) => element.textContent.trim() !== "");

  const headings = headingsOf(body.value);

  const recreate = useMutation({
    mutationFn: async () =>
      await request("POST /wiki/:pageId/restore", {
        params: { pageId: page.id },
      }),
    onError: notifyError(`Could not restore ${page.path}`),
    onSuccess: async (restored) => {
      setPage(queryClient, wiki, restored);
      title.handleRebase(restored.title);
      body.handleRebase(restored.body);

      if (restored.path !== page.path) {
        await navigate(wikiTarget(wiki, restored.path));
      }
    },
  });

  const copy = useMutation({
    mutationFn: async () =>
      await saveAsNewPage(
        wiki,
        page.path,
        { body: body.value, title: title.value.trim() || page.title },
        new Set(
          queryClient
            .getQueryData(wikiPagesQuery(wiki).queryKey)
            ?.map((node) => node.path)
        )
      ),
    onError: notifyError("Could not save a new page"),
    onSuccess: async (created) => {
      setPage(queryClient, wiki, created);

      for (const key of wikiDraftKeys(page.id)) {
        discardDraft(key);
      }

      await navigate({ ...wikiTarget(wiki, created.path), replace: true });
      onRelease();
    },
  });

  return (
    <Page
      actions={
        <>
          <SaveState
            onRetry={save}
            status={status === "conflict" ? "pending" : status}
          />
          {status === "saved" ? (
            <EditedButton
              onHistory={() => {
                actions.open("history");
              }}
              page={page}
            />
          ) : null}
          {deleted || copy.isPending ? null : (
            <div className="flex max-md:hidden">
              <AttachButton
                onFiles={(files) => {
                  editor.current?.upload(files);
                }}
              />
            </div>
          )}
          <SourceToggle
            className="max-md:hidden"
            onChange={setSource}
            source={source}
          />
          <SourceIconToggle onChange={setSource} source={source} />
          <CopyLinkButton id={page.id} />
          <PageMenu actions={actions} />
        </>
      }
      className="flex overflow-hidden"
      crumbs={crumbs}
      title={title.value.trim() || page.title}
    >
      <div className="min-w-0 flex-1 overflow-y-auto xl:grid xl:grid-cols-[minmax(10rem,1fr)_minmax(0,calc(var(--container-document)+6rem))_minmax(10rem,1fr)] xl:items-start">
        <article className="max-w-document mx-auto box-content flex flex-col gap-2 px-4 pt-5 pb-16 md:px-8 md:pt-8 xl:col-start-2 xl:row-start-1 xl:mx-0 xl:px-12">
          {lookupError === null ? null : (
            <LoadFailed
              className="mb-3"
              error={lookupError}
              onRetry={onRetryLookup}
              title={`Could not find ${page.path}`}
            />
          )}
          {replacement === null ? null : (
            <ReplacedBanner
              onCopy={() => {
                void copyText(body.value, "text");
              }}
              onOpen={() => {
                for (const key of wikiDraftKeys(page.id)) {
                  discardDraft(key);
                }

                onRelease();
              }}
              onSaveAs={() => {
                copy.mutate();
              }}
              path={page.path}
              pending={copy.isPending}
              replacement={replacement.title}
            />
          )}
          {deleted && replacement === null ? (
            <DeletedBanner
              onRestore={() => {
                recreate.mutate();
              }}
              path={page.path}
              pending={recreate.isPending}
            />
          ) : null}
          <p className="text-muted-foreground truncate font-mono text-xs">
            {page.path}
          </p>
          <PageTitle
            autosave={!deleted}
            draft={title}
            onDone={() => {
              editor.current?.focus();
            }}
            readOnly={recreate.isPending || copy.isPending}
          />
          <div className="[&_.ProseMirror]:min-h-[50vh]" ref={bodyBox}>
            <MarkdownEditor
              autoFocus={page.body === ""}
              className="text-prose"
              editable={!(recreate.isPending || copy.isPending)}
              draft={body.draft}
              label={`${page.title} body`}
              onChange={body.handleChange}
              placeholder="Write something… Type / for blocks"
              ref={editor}
              source={source}
              uploadTo={
                deleted || copy.isPending
                  ? undefined
                  : `/wiki/${page.id}/attachments`
              }
              value={body.value}
            />
          </div>
          <div className="mt-8">
            <AttachmentList
              body={body.value}
              editable={!deleted}
              hint="Paste or drop files into the page, or attach them here."
              id={page.id}
              path={`/wiki/${page.id}/attachments`}
            />
          </div>
        </article>
        {rail && headings.length > 1 ? (
          <aside
            aria-label="Page details"
            className="sticky top-0 col-start-3 row-start-1 flex max-h-[calc(100svh-2.75rem)] max-w-72 flex-col gap-6 overflow-y-auto py-8 pr-6"
          >
            <Contents
              headings={headings}
              onJump={(index) => {
                headingElements()[index]?.scrollIntoView({
                  behavior: reducedMotion() ? "auto" : "smooth",
                  block: "start",
                });
              }}
            />
          </aside>
        ) : null}
      </div>
      <ConflictDialog
        field="title"
        mine={title.value}
        onKeepMine={title.handleKeepMine}
        onUseTheirs={title.handleDiscard}
        saved={title.conflict}
      />
      <ConflictDialog
        field="page"
        mine={body.value}
        onKeepMine={body.handleKeepMine}
        onUseTheirs={body.handleDiscard}
        saved={body.conflict}
      />
    </Page>
  );
};

const MissingPage = ({
  crumbs,
  path,
  wiki,
}: {
  crumbs: Crumb[];
  path: string;
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: async () =>
      await createPage(wiki, path, { body: "", title: humanize(path) }),
    onError: notifyError(`Could not create ${path}`),
    onSuccess: (page) => {
      setPage(queryClient, wiki, page);
    },
  });

  return (
    <Page crumbs={crumbs} title={humanize(path)}>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>
            <h2>No page at {path}</h2>
          </EmptyTitle>
          <EmptyDescription>
            Create it to start writing, or pick a page in the sidebar.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            disabled={create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Create page
          </Button>
        </EmptyContent>
      </Empty>
    </Page>
  );
};

const useMovedPage = (
  wiki: Wiki,
  path: string,
  missing: boolean,
  id: string
) => {
  const queryClient = useQueryClient();

  const moved = useQuery({
    enabled: missing && id !== "",
    queryFn: async () => {
      const current = await request("GET /wiki/:pageId", {
        params: { pageId: id },
      });

      queryClient.setQueryData(
        wikiPageQuery(wiki, current.path).queryKey,
        current
      );

      return current;
    },
    queryKey: ["wiki", wiki.key, "id", id],
  });

  const target = missing && moved.data?.path !== path ? moved.data?.path : null;

  const redirect =
    target === null || target === undefined ? null : (
      <Navigate {...wikiTarget(wiki, target)} replace />
    );

  return { moved, redirect };
};

const useKeptPage = (
  wiki: Wiki,
  path: string,
  fetched: WikiPage | undefined
) => {
  const key = keptKey(wiki, path);

  const [current, setCurrent] = useState<KeptState>(() => ({
    kept: readKept(key),
    key,
    shown: fetched,
  }));

  const dirty = useHasDraft(
    current.shown === undefined ? [] : wikiDraftKeys(current.shown.id)
  );

  const next = nextKept(current, key, fetched, dirty);

  if (next !== null) {
    setCurrent(next);
  }

  useEffect(() => {
    storeKept(current.key, current.kept);
  }, [current]);

  const release = () => {
    storeKept(key, null);
    setCurrent({ kept: null, key, shown: fetched });
  };

  return [current.key === key ? current.kept : null, release] as const;
};

const WikiPageScreen = ({
  crumbs,
  path,
  wiki,
}: {
  crumbs: Crumb[];
  path: string;
  wiki: Wiki;
}) => {
  const page = useQuery(wikiPageQuery(wiki, path));
  const missing = page.error instanceof ApiError && page.error.status === 404;

  const { moved, redirect } = useMovedPage(
    wiki,
    path,
    missing,
    page.data?.id ?? ""
  );

  const state = missingState(page.error, moved.error);
  const deleted = state === "deleted";
  const [kept, release] = useKeptPage(wiki, path, page.data);

  if (kept !== null) {
    return (
      <PageEditor
        crumbs={crumbs}
        deleted
        key={kept.id}
        lookupError={null}
        onRelease={release}
        onRetryLookup={() => {
          void moved.refetch();
        }}
        page={kept}
        replacement={page.data ?? null}
        wiki={wiki}
      />
    );
  }

  if (page.data?.kind === "page") {
    return (
      <>
        {redirect}
        <PageEditor
          crumbs={crumbs}
          deleted={deleted}
          key={page.data.id}
          lookupError={state === "unknown" ? moved.error : null}
          onRelease={release}
          onRetryLookup={() => {
            void moved.refetch();
          }}
          page={page.data}
          replacement={null}
          wiki={wiki}
        />
      </>
    );
  }

  if (redirect !== null) {
    return redirect;
  }

  if (page.data?.kind === "folder" && !deleted) {
    return <FolderView crumbs={crumbs} folder={page.data} wiki={wiki} />;
  }

  if (missing) {
    return <MissingPage crumbs={crumbs} path={path} wiki={wiki} />;
  }

  return (
    <Page crumbs={crumbs} title={humanize(path)}>
      {page.isError ? (
        <LoadFailed
          className="m-4"
          error={page.error}
          onRetry={() => {
            void page.refetch();
          }}
          title={`Could not load ${path}`}
        />
      ) : (
        <div
          aria-busy
          className="max-w-document mx-auto box-content flex flex-col gap-3 px-4 pt-5 md:px-8 md:pt-8 xl:px-12"
        >
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )}
    </Page>
  );
};

const WikiScreen = ({
  crumbs,
  path: rawPath,
  wiki,
}: {
  crumbs: Crumb[];
  path: string;
  wiki: Wiki;
}) => {
  const pages = useQuery(wikiPagesQuery(wiki));
  const path = rawPath.toLowerCase().split("/").filter(Boolean).join("/");

  usePageTitle(pages.data?.find((page) => page.path === path)?.title);

  if (path === "") {
    return <WikiIndex crumbs={crumbs} wiki={wiki} />;
  }

  const titleOf = (target: string) =>
    pages.data?.find((page) => page.path === target)?.title ?? humanize(target);

  return (
    <WikiPageScreen
      crumbs={[
        ...crumbs.map(({ label, link }) => ({ label, link })),
        { label: "Wiki", link: <Link {...wikiTarget(wiki, "")} /> },
        ...ancestors(path).map((target) => ({
          label: titleOf(target),
          link: <Link {...wikiTarget(wiki, target)} />,
        })),
      ]}
      path={path}
      wiki={wiki}
    />
  );
};

const useWorkspaceCrumb = (): Crumb => {
  const workspace = useWorkspace();

  return {
    label: workspace.name,
    link: <Link params={{ slug: workspace.slug }} to="/$slug/my-issues" />,
    short: workspace.name,
  };
};

export const WorkspaceWiki = ({ path }: { path: string }) => {
  const workspace = useWorkspace();
  const crumb = useWorkspaceCrumb();

  return (
    <WikiScreen crumbs={[crumb]} path={path} wiki={workspaceWiki(workspace)} />
  );
};
