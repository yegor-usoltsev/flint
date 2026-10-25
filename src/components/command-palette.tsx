import {
  keepPreviousData,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DeleteIcon,
  FileTextIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { createContext, use, useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { Keys, ShortcutsDialog } from "~/components/shortcuts-dialog";
import { StatusIcon } from "~/components/status-icon";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/ui/command";
import { useSidebar } from "~/components/ui/sidebar";
import { WikiCreateCommands } from "~/components/wiki-actions";
import { api, signOut, useMe } from "~/lib/api";
import type {
  IssueSummary,
  SearchResults,
  Status,
  WikiPageHit,
} from "~/lib/api-types";
import { copyIssues } from "~/lib/copy";
import type { IssueCopy } from "~/lib/copy";
import { useDeleteIssue } from "~/lib/issue-actions";
import {
  blurRow,
  cachedIssues,
  focusedId,
  focusedIndex,
  focusNeighbour,
  hasRows,
  keepRowFocus,
  moveColumn,
  moveFocus,
  onBoard,
  refocusRow,
  rowToRefocus,
  rowOrder,
  targetIssues,
  useCachedIssues,
  useHoverFocus,
} from "~/lib/issue-focus";
import {
  pickerTitles,
  projectKeyOf,
  useCreateLabel,
  usePicker,
} from "~/lib/issue-options";
import type { Picker, PickerOption } from "~/lib/issue-options";
import {
  clearSelection,
  extended,
  getSelection,
  hasSelection,
  selectedAll,
  setSelection,
  toggled,
} from "~/lib/issue-selection";
import { rememberView } from "~/lib/issue-view";
import type { ViewKind } from "~/lib/issue-view";
import { projectQuery, projectsQuery } from "~/lib/queries";
import { resultGroups } from "~/lib/search-groups";
import type { GroupKind, ResultGroup } from "~/lib/search-groups";
import { setTheme } from "~/lib/theme";
import { listCommands, useCommands } from "~/lib/use-hotkey";
import type { Command as PaletteCommand, Hotkey } from "~/lib/use-hotkey";
import { writeIssues } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";
import { wikiTarget } from "~/lib/wiki";

interface PaletteState {
  index: number;
  issues: IssueSummary[];
  open: boolean;
  picker: Picker | null;
}

const closed: PaletteState = {
  index: -1,
  issues: [],
  open: false,
  picker: null,
};

const go = (
  id: string,
  label: string,
  keys: string | undefined,
  run: () => void,
  when?: () => boolean
): PaletteCommand => ({
  group: "Navigation",
  hotkey: keys === undefined ? undefined : { keys },
  id,
  label,
  run,
  when,
});

const hasModifier = (event: KeyboardEvent<HTMLDivElement>) =>
  event.metaKey || event.ctrlKey || event.altKey;

const isDigitPress = (event: KeyboardEvent<HTMLDivElement>) =>
  !event.nativeEvent.isComposing &&
  /^\d$/u.test(event.key) &&
  !hasModifier(event);

const groupOrder = [
  "Issue",
  "Page",
  "Create",
  "Navigation",
  "View",
  "Projects",
  "Workspaces",
  "Theme",
  "Account",
];

const OpenPalette = createContext<(() => void) | null>(null);

export const useOpenPalette = () => use(OpenPalette);

const OpenHelp = createContext<(() => void) | null>(null);

export const useOpenHelp = () => use(OpenHelp);

const issueKeyPattern = /^[a-z][a-z0-9]{1,4}-\d+$/iu;

const matchesQuery = (query: string, ...texts: (string | undefined)[]) => {
  const haystack = texts.join(" ").toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/u)
    .every((token) => haystack.includes(token));
};

const useDebounced = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [delay, value]);

  return debounced;
};

const searchQuery = (slug: string, q: string, mode: "fts" | "hybrid") => ({
  enabled: q.length >= 2,
  queryFn: async () =>
    await api<SearchResults>(
      `/workspaces/${slug}/search?${new URLSearchParams({ mode, q }).toString()}`
    ),
  queryKey: ["search", slug, mode, q],
  staleTime: 30_000,
});

const useSearch = (slug: string, query: string) => {
  const q = useDebounced(query.trim(), 120);

  const fts = useQuery({
    ...searchQuery(slug, q, "fts"),
    placeholderData: keepPreviousData,
  });

  const hybrid = useQuery(searchQuery(slug, q, "hybrid"));
  const fresh = hybrid.data !== undefined || !fts.isPlaceholderData;

  return {
    current: fresh && q === query.trim(),
    failed: query.trim().length >= 2 && fts.isError && hybrid.isError,
    results: query.trim().length < 2 ? null : (hybrid.data ?? fts.data ?? null),
    retry: () => {
      void fts.refetch();
      void hybrid.refetch();
    },
  };
};

const useStatuses = (slug: string) => {
  const projects = useQuery(projectsQuery(slug));

  return useQueries({
    combine: (results) =>
      new Map(
        results.flatMap(
          (result) =>
            result.data?.statuses.map(
              (status) => [status.id, status] as const
            ) ?? []
        )
      ),
    queries: (projects.data ?? []).map((project) => projectQuery(project.key)),
  });
};

const ScopeChip = ({ issues }: { issues: IssueSummary[] }) => {
  const [issue] = issues;

  if (issue === undefined) {
    return null;
  }

  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-2 px-3 pt-2 text-xs">
      {issues.length === 1 ? (
        <>
          <span className="bg-muted text-foreground shrink-0 rounded px-1.5 py-0.5 tabular-nums">
            {issue.key}
          </span>
          <span className="truncate">{issue.title}</span>
        </>
      ) : (
        <span className="bg-muted text-foreground flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 tabular-nums">
          {issues.length} issues
          <DeleteIcon aria-hidden className="text-muted-foreground size-3.5" />
        </span>
      )}
    </div>
  );
};

const dropScope = (
  event: KeyboardEvent<HTMLDivElement>,
  query: string,
  onDrop: (() => void) | undefined
) => {
  if (event.key === "Backspace" && query === "" && onDrop !== undefined) {
    event.preventDefault();
    onDrop();
  }
};

const PickerList = ({
  issues,
  onClose,
  picker,
}: {
  issues: IssueSummary[];
  onClose: () => void;
  picker: Picker;
}) => {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const live = useCachedIssues(issues);
  const { options, writes } = usePicker(picker, live);
  const name = query.trim();

  const shown = options.filter((option) =>
    matchesQuery(name, option.label, option.keywords)
  );

  const createLabel = useCreateLabel((label) => {
    writeIssues(
      queryClient,
      live.map((issue) => ({
        issue,
        patch: { addLabelIds: [label.id] },
      }))
    );
    setQuery("");
  });

  const creatable =
    picker === "labels" &&
    name !== "" &&
    !options.some(
      (option) => option.label.toLowerCase() === name.toLowerCase()
    );

  const highlighted =
    name === "" && picker !== "labels"
      ? options.find((option) => option.checked)?.value
      : shown[0]?.value;

  const select = (option: PickerOption) => {
    writeIssues(queryClient, writes(option));

    if (picker !== "labels") {
      onClose();
    }
  };

  return (
    <Command
      loop
      onValueChange={setSelected}
      value={selected ?? highlighted ?? ""}
      onKeyDown={(event) => {
        if (query === "" && isDigitPress(event)) {
          const option = options.find(
            (item) => item.number === Number(event.key)
          );

          event.preventDefault();

          if (option !== undefined) {
            select(option);
          }
        }
      }}
      shouldFilter={false}
      vimBindings={false}
    >
      <ScopeChip issues={live} />
      <CommandInput
        aria-label={pickerTitles[picker]}
        onValueChange={(value) => {
          setQuery(value);
          setSelected(null);
        }}
        placeholder={pickerTitles[picker]}
        value={query}
      />
      <CommandList className="max-h-96">
        {creatable ? null : <CommandEmpty>No matches</CommandEmpty>}
        <CommandGroup>
          {shown.map((option) => (
            <CommandItem
              key={option.value}
              onSelect={() => {
                select(option);
              }}
              value={option.value}
            >
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.checked ? (
                <CheckIcon aria-label="Selected" className="size-4" />
              ) : null}
              <CommandShortcut>{option.number}</CommandShortcut>
            </CommandItem>
          ))}
          {creatable ? (
            <CommandItem
              onSelect={() => {
                createLabel.mutate(name);
              }}
              value={`create:${name}`}
            >
              <PlusIcon />
              <span className="min-w-0 flex-1 truncate">
                Create label “{name}”
              </span>
            </CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

const jumpKey = (query: string, found: IssueSummary[]) => {
  const key = query.toUpperCase();

  return issueKeyPattern.test(query) && !found.some((item) => item.key === key)
    ? key
    : null;
};

const highlight = (options: string[], selected: string | null) =>
  selected !== null && options.includes(selected)
    ? selected
    : (options[0] ?? "");

const hitValue = (kind: GroupKind, id: string) =>
  `${kind === "issues" ? "issue" : "page"}-${id}`;

const groupValues = (group: ResultGroup) => [
  ...group.hits.map(({ id }) => hitValue(group.kind, id)),
  ...(group.extra === 0 ? [] : [`more-${group.kind}`]),
];

const IssueResult = ({
  current,
  issue,
  onSelect,
  status,
}: {
  current: boolean;
  issue: IssueSummary;
  onSelect: () => void;
  status?: Status;
}) => (
  <CommandItem
    disabled={!current}
    onSelect={onSelect}
    value={hitValue("issues", issue.id)}
  >
    {status === undefined ? null : (
      <StatusIcon category={status.category} color={status.color} />
    )}
    <span className="text-muted-foreground w-16 shrink-0 text-xs tabular-nums">
      {issue.key}
    </span>
    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
  </CommandItem>
);

const PageResult = ({
  current,
  onSelect,
  page,
}: {
  current: boolean;
  onSelect: () => void;
  page: WikiPageHit;
}) => (
  <CommandItem
    disabled={!current}
    onSelect={onSelect}
    value={hitValue("pages", page.id)}
  >
    <BookOpenIcon />
    <span className="min-w-0 flex-1 truncate">{page.title}</span>
    <span className="text-muted-foreground max-w-1/3 truncate text-xs">
      {page.path}
    </span>
  </CommandItem>
);

const RootList = ({
  commands: own,
  issues,
  onClose,
  onDropScope,
}: {
  commands: PaletteCommand[];
  issues: IssueSummary[];
  onClose: () => void;
  onDropScope: () => void;
}) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<GroupKind[]>([]);

  const { current, failed, results, retry } = useSearch(workspace.slug, query);
  const scoped = useCachedIssues(issues);

  const statuses = useStatuses(workspace.slug);
  const trimmed = query.trim();

  const commands = [...listCommands(), ...own].filter(
    (command) =>
      command.label !== undefined &&
      (command.when?.() ?? true) &&
      matchesQuery(trimmed, command.label, command.keywords)
  );

  const groups = Map.groupBy(commands, (command) => command.group ?? "View");

  const sortedGroups = [...groups].toSorted(
    ([a], [b]) =>
      (groupOrder.indexOf(a) + 1 || groupOrder.length + 1) -
      (groupOrder.indexOf(b) + 1 || groupOrder.length + 1)
  );

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const openIssue = (issueKey: string) =>
    run(() => {
      void navigate({
        params: { issueKey, slug: workspace.slug },
        to: "/$slug/issue/$issueKey",
      });
    });

  const found = results?.issues ?? [];
  const pages = results?.pages ?? [];

  const jump = current ? jumpKey(trimmed, found) : jumpKey(trimmed, []);

  const openPage = (page: WikiPageHit) =>
    run(() => {
      void navigate(wikiTarget(workspace, page.path));
    });

  const hits = resultGroups(found, pages, expanded);

  const toggle = (group: ResultGroup) => () => {
    setExpanded(
      group.open
        ? expanded.filter((kind) => kind !== group.kind)
        : [...expanded, group.kind]
    );
  };

  const options = [
    jump === null ? [] : [`jump-${jump}`],
    sortedGroups.flatMap(([, items]) => items.map((command) => command.id)),
    current ? hits.flatMap(groupValues) : [],
    failed ? ["search-retry"] : [],
  ].flat();

  return (
    <Command
      loop
      onKeyDown={(event) => {
        dropScope(event, query, scoped.length > 1 ? onDropScope : undefined);
      }}
      onValueChange={setSelected}
      shouldFilter={false}
      vimBindings={false}
      value={highlight(options, selected)}
    >
      <ScopeChip issues={scoped} />
      <CommandInput
        aria-label="Type a command or search"
        onValueChange={(value) => {
          setQuery(value);
          setSelected(null);
          setExpanded([]);
        }}
        placeholder="Type a command or search…"
        value={query}
      />
      <CommandList className="max-h-104">
        <CommandEmpty>
          {trimmed.length >= 2 && results === null
            ? "Searching…"
            : "No results"}
        </CommandEmpty>
        {jump === null ? null : (
          <CommandGroup heading="Go to issue">
            <CommandItem onSelect={openIssue(jump)} value={`jump-${jump}`}>
              <FileTextIcon />
              Open {jump}
            </CommandItem>
          </CommandGroup>
        )}
        {sortedGroups.map(([group, items]) => (
          <CommandGroup heading={group} key={group}>
            {items.map((command) => (
              <CommandItem
                key={command.id}
                onSelect={run(command.run)}
                value={command.id}
              >
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hotkey === undefined ? null : (
                  <span
                    className="ml-auto max-md:hidden"
                    data-slot="command-shortcut"
                  >
                    <Keys hotkey={command.hotkey} />
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {hits.map((group) => (
          <CommandGroup
            heading={group.kind === "issues" ? "Issues" : "Wiki pages"}
            key={group.kind}
          >
            {group.kind === "issues"
              ? group.hits.map((item) => (
                  <IssueResult
                    current={current}
                    issue={item}
                    key={item.id}
                    onSelect={openIssue(item.key)}
                    status={statuses.get(item.statusId)}
                  />
                ))
              : group.hits.map((page) => (
                  <PageResult
                    current={current}
                    key={page.id}
                    onSelect={openPage(page)}
                    page={page}
                  />
                ))}
            {group.extra === 0 ? null : (
              <CommandItem
                disabled={!current}
                onSelect={toggle(group)}
                value={`more-${group.kind}`}
              >
                {group.open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {group.open ? "Show fewer" : `Show ${group.extra} more`}{" "}
                  {group.kind === "issues" ? "issues" : "pages"}
                </span>
              </CommandItem>
            )}
          </CommandGroup>
        ))}
        {failed ? (
          <CommandGroup heading="Search">
            <CommandItem onSelect={retry} value="search-retry">
              <RotateCwIcon />
              <span className="min-w-0 flex-1 truncate">
                Search unavailable · Retry
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
};

const plural = (issues: IssueSummary[], one: string, many: string) =>
  issues.length > 1 ? many : one;

const extendFocus = (step: 1 | -1) => {
  const from = focusedId();

  moveFocus(step);

  const to = focusedId();

  if (from !== null && to !== null) {
    setSelection(extended(getSelection(), rowOrder(), from, to));
  }
};

const selectionCommands: PaletteCommand[] = [
  {
    hotkey: { keys: "escape" },
    id: "clear-selection",
    run: clearSelection,
    when: hasSelection,
  },
  {
    hotkey: { keys: "x" },
    id: "select",
    run: () => {
      const id = focusedId();

      if (id !== null) {
        setSelection(toggled(getSelection(), id));
      }
    },
    when: () => focusedId() !== null,
  },
  {
    hotkey: { keys: "arrowdown", repeat: true, shift: true },
    id: "select-next",
    run: () => {
      extendFocus(1);
    },
    when: hasRows,
  },
  {
    hotkey: { keys: "arrowup", repeat: true, shift: true },
    id: "select-previous",
    run: () => {
      extendFocus(-1);
    },
    when: hasRows,
  },
  {
    hotkey: { keys: "a", mod: true },
    id: "select-all",
    run: () => {
      setSelection(selectedAll(rowOrder()));
    },
    when: hasRows,
  },
];

const useLayerCommands = ({
  openPicker,
  openRoot,
  openHelp,
  target,
}: {
  openHelp: () => void;
  openPicker: (picker: Picker, issues: IssueSummary[]) => void;
  openRoot: () => void;
  target: () => IssueSummary[];
}) => {
  const workspace = useWorkspace();
  const me = useMe().data;
  const username = me?.username ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deletion = useDeleteIssue();
  const { toggleSidebar } = useSidebar();
  const { issueKey: openKey, key: routeProject } = useParams({ strict: false });
  const projects = useQuery(projectsQuery(workspace.slug));
  const { slug } = workspace;
  const targets = target();

  const project = () => {
    const [issue] = target();

    return routeProject ?? (issue === undefined ? null : projectKeyOf(issue));
  };

  const onIssues =
    (action: (issues: IssueSummary[]) => void): (() => void) =>
    () => {
      const issues = target();

      if (issues.length > 0) {
        action(issues);
      }
    };

  const hasIssue = () => target().length > 0;

  const elsewhere = () => {
    const issues = target();

    return issues.length === 1 && issues[0]?.key !== openKey;
  };

  const hasProject = () => project() !== null;

  const mine =
    targets.length > 0 && targets.every((issue) => issue.assigneeId === me?.id);

  const issueCommand = (
    id: string,
    label: string,
    hotkey: Hotkey | undefined,
    action: (issues: IssueSummary[]) => void
  ): PaletteCommand => ({
    group: "Issue",
    hotkey,
    id,
    label,
    run: onIssues(action),
    when: hasIssue,
  });

  const copyCommand = (
    what: IssueCopy,
    one: string,
    many: string,
    hotkey?: Hotkey
  ) =>
    issueCommand(
      `copy-${what}`,
      plural(targets, one, many),
      hotkey,
      (issues) => {
        copyIssues(issues, what, slug, username);
      }
    );

  const openView = (view: ViewKind) => {
    const key = project();

    if (key !== null) {
      rememberView(key, view);
      void navigate({ params: { key, slug }, to: "/$slug/project/$key" });
    }
  };

  useHoverFocus();

  const commands: PaletteCommand[] = [
    ...selectionCommands,
    issueCommand("assignee", "Assign to…", { keys: "a" }, (issues) => {
      openPicker("assignee", issues);
    }),
    issueCommand(
      "assign-me",
      mine ? "Unassign" : "Assign to me",
      { keys: "i" },
      (issues) => {
        const unassign = issues.every((issue) => issue.assigneeId === me?.id);
        const assigneeId = unassign ? null : (me?.id ?? null);

        keepRowFocus();
        writeIssues(
          queryClient,
          issues.flatMap((issue) =>
            issue.assigneeId === assigneeId
              ? []
              : [{ issue, patch: { assigneeId } }]
          )
        );
      }
    ),
    issueCommand("status", "Change status…", { keys: "s" }, (issues) => {
      openPicker("status", issues);
    }),
    issueCommand("priority", "Change priority…", { keys: "p" }, (issues) => {
      openPicker("priority", issues);
    }),
    issueCommand(
      "labels",
      plural(targets, "Change labels…", "Change or add labels…"),
      { keys: "l" },
      (issues) => {
        openPicker("labels", issues);
      }
    ),
    {
      ...issueCommand("open", "Open issue", undefined, ([issue]) => {
        if (issue !== undefined) {
          void navigate({
            params: { issueKey: issue.key, slug },
            to: "/$slug/issue/$issueKey",
          });
        }
      }),
      when: elsewhere,
    },
    copyCommand("id", "Copy issue ID", "Copy issue IDs", {
      keys: ".",
      mod: true,
    }),
    copyCommand("url", "Copy issue URL", "Copy issue URLs", {
      keys: ",",
      mod: true,
      shift: true,
    }),
    copyCommand("title", "Copy issue title", "Copy issue titles"),
    copyCommand("link", "Copy title as link", "Copy titles as links"),
    copyCommand("branch", "Copy git branch name", "Copy git branch names", {
      keys: ".",
      mod: true,
      shift: true,
    }),
    issueCommand(
      "delete",
      plural(targets, "Delete issue", "Delete issues"),
      { keys: "backspace", mod: true },
      (issues) => {
        if (issues.length === 1 && issues[0]?.key !== openKey) {
          focusNeighbour();
        }

        void deletion.remove(issues);
      }
    ),
    go("my-issues", "Go to My issues", "g m", () => {
      void navigate({ params: { slug }, to: "/$slug/my-issues" });
    }),
    go("projects", "Go to projects", "g p", () => {
      void navigate({ params: { slug }, to: "/$slug/settings/projects" });
    }),
    go(
      "list",
      "Go to list",
      "g l",
      () => {
        openView("list");
      },
      hasProject
    ),
    go(
      "board",
      "Go to board",
      "g b",
      () => {
        openView("board");
      },
      hasProject
    ),
    go("wiki", "Go to wiki", "g w", () => {
      void navigate(wikiTarget(workspace, ""));
    }),
    go("settings", "Go to settings", "g s", () => {
      void navigate({ params: { slug }, to: "/$slug/settings" });
    }),
    go("trash", "Go to trash", "g t", () => {
      void navigate({ params: { slug }, to: "/$slug/settings/trash" });
    }),
    go("labels-settings", "Go to labels", undefined, () => {
      void navigate({ params: { slug }, to: "/$slug/settings/labels" });
    }),
    go("api-keys", "Go to API keys", undefined, () => {
      void navigate({
        params: { slug },
        to: "/$slug/settings/account/api-keys",
      });
    }),
    ...(projects.data ?? []).map((item): PaletteCommand => ({
      group: "Projects",
      id: `project-${item.id}`,
      keywords: item.key,
      label: `Open ${item.name}`,
      run: () => {
        void navigate({
          params: { key: item.key, slug },
          to: "/$slug/project/$key",
        });
      },
    })),
    ...(me?.workspaces ?? []).flatMap((item): PaletteCommand[] =>
      item.slug === slug
        ? []
        : [
            {
              group: "Workspaces",
              id: `workspace-${item.id}`,
              label: `Switch to ${item.name}`,
              run: () => {
                void navigate({ params: { slug: item.slug }, to: "/$slug" });
              },
            },
          ]
    ),
    {
      group: "View",
      hotkey: { keys: "[" },
      id: "sidebar",
      label: "Toggle sidebar",
      run: toggleSidebar,
    },
    {
      group: "View",
      hotkey: { keys: "?" },
      id: "shortcuts",
      label: "Keyboard shortcuts",
      run: openHelp,
    },
    ...(["light", "dark", "system"] as const).map((theme): PaletteCommand => ({
      group: "Theme",
      id: `theme-${theme}`,
      keywords: "theme appearance",
      label:
        theme === "system"
          ? "Use the system theme"
          : `Switch to the ${theme} theme`,
      run: () => {
        setTheme(theme);
      },
    })),
    {
      group: "Account",
      id: "sign-out",
      keywords: "log out",
      label: "Sign out",
      run: () => {
        void signOut();
      },
    },
    {
      hotkey: { inInputs: true, keys: "k", mod: true },
      id: "palette",
      run: openRoot,
    },
    { hotkey: { keys: "/" }, id: "search", run: openRoot },
    {
      hotkey: { keys: "j", repeat: true },
      id: "next",
      run: () => {
        moveFocus(1);
      },
      when: hasRows,
    },
    {
      hotkey: { keys: "k", repeat: true },
      id: "previous",
      run: () => {
        moveFocus(-1);
      },
      when: hasRows,
    },
    {
      hotkey: { keys: "arrowdown", repeat: true },
      id: "next-arrow",
      run: () => {
        moveFocus(1);
      },
      when: hasRows,
    },
    {
      hotkey: { keys: "arrowup", repeat: true },
      id: "previous-arrow",
      run: () => {
        moveFocus(-1);
      },
      when: hasRows,
    },
    {
      hotkey: { keys: "arrowleft", repeat: true },
      id: "previous-column-arrow",
      run: () => {
        moveColumn(-1);
      },
      when: onBoard,
    },
    {
      hotkey: { keys: "arrowright", repeat: true },
      id: "next-column-arrow",
      run: () => {
        moveColumn(1);
      },
      when: onBoard,
    },
    { hotkey: { keys: "escape" }, id: "blur", run: blurRow, when: hasIssue },
  ];

  useCommands(commands, true);

  return commands;
};

export const CommandLayer = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [palette, setPalette] = useState(closed);
  const [help, setHelp] = useState(false);

  useEffect(
    () =>
      router.subscribe("onResolved", ({ pathChanged }) => {
        if (pathChanged) {
          clearSelection();
        }
      }),
    [router]
  );

  const close = () => {
    setPalette((current) => ({ ...current, open: false }));
  };

  const target = () =>
    palette.open
      ? cachedIssues(queryClient, palette.issues)
      : targetIssues(queryClient);

  const openRoot = useCallback(() => {
    setPalette((current) =>
      current.open
        ? { ...current, open: false }
        : {
            index: focusedIndex(),
            issues: targetIssues(queryClient),
            open: true,
            picker: null,
          }
    );
  }, [queryClient]);

  const showHelp = useCallback(() => {
    setHelp(true);
  }, []);

  const commands = useLayerCommands({
    openHelp: showHelp,
    openPicker: (picker, issues) => {
      setPalette((current) => ({
        index: current.open ? current.index : focusedIndex(),
        issues,
        open: true,
        picker,
      }));
    },
    openRoot,
    target,
  });

  return (
    <OpenPalette value={openRoot}>
      <OpenHelp value={showHelp}>{children}</OpenHelp>
      <CommandDialog
        className="flex max-h-[calc(100dvh-1.5rem)] flex-col max-sm:top-3 sm:top-32.5 sm:max-h-112.5 sm:max-w-180"
        description="Run a command, jump to a page or search issues"
        finalFocus={() => {
          const [issue] = palette.issues;

          return (
            (issue === undefined || palette.index < 0
              ? undefined
              : rowToRefocus(issue.id, palette.index)) ?? true
          );
        }}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        onOpenChangeComplete={(open) => {
          const [issue] = palette.issues;

          if (!open && issue !== undefined) {
            refocusRow(issue.id, palette.index);
          }
        }}
        open={palette.open}
        title="Command menu"
      >
        {palette.picker !== null && palette.issues.length > 0 ? (
          <PickerList
            issues={palette.issues}
            onClose={close}
            picker={palette.picker}
          />
        ) : (
          <RootList
            commands={commands}
            issues={palette.issues}
            onClose={close}
            onDropScope={() => {
              setPalette((current) => ({ ...current, issues: [] }));
            }}
          />
        )}
      </CommandDialog>
      <ShortcutsDialog onOpenChange={setHelp} open={help} />
      <WikiCreateCommands />
    </OpenPalette>
  );
};
