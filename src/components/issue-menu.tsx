import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesColumnIncreasingIcon,
  CheckIcon,
  ClipboardIcon,
  ContrastIcon,
  SquareCheckIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { CheckBox } from "~/components/issue-parts";
import {
  MenuFilterInput,
  MenuKeys,
  RootMenuFilter,
} from "~/components/menu-filter";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { useUsername } from "~/lib/api";
import type { IssueSummary } from "~/lib/api-types";
import { copyIssues } from "~/lib/copy";
import type { IssueCopy } from "~/lib/copy";
import { useDeleteIssue } from "~/lib/issue-actions";
import {
  findIssue,
  selectedIssues,
  setMenuCloser,
  useCachedIssues,
} from "~/lib/issue-focus";
import { pickerTitles, usePicker } from "~/lib/issue-options";
import type { Picker, PickerOption } from "~/lib/issue-options";
import { getSelection, setSelection, toggled } from "~/lib/issue-selection";
import { isCoarsePointer } from "~/lib/use-hotkey";
import type { Hotkey } from "~/lib/use-hotkey";
import { writeIssues } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

const isDigit = (event: KeyboardEvent<HTMLInputElement>) => {
  const modified = event.metaKey || event.ctrlKey || event.altKey;

  return /^\d$/u.test(event.key) && !modified && !event.nativeEvent.isComposing;
};

const LabelItem = ({
  onSelect,
  option,
}: {
  onSelect: () => void;
  option: PickerOption;
}) => (
  <DropdownMenuCheckboxItem
    checked={option.checked}
    closeOnClick={false}
    indicator={false}
    label={option.label}
    onCheckedChange={onSelect}
  >
    <CheckBox checked={option.checked} />
    {option.icon}
    <span className="min-w-0 flex-1 truncate">{option.label}</span>
  </DropdownMenuCheckboxItem>
);

const OptionItem = ({
  onSelect,
  option,
}: {
  onSelect: () => void;
  option: PickerOption;
}) => (
  <DropdownMenuItem label={option.label} onClick={onSelect}>
    {option.icon}
    <span className="min-w-0 flex-1 truncate">{option.label}</span>
    {option.checked ? (
      <CheckIcon aria-label="Current" className="size-4" />
    ) : null}
    {option.number === undefined ? null : (
      <DropdownMenuShortcut>{option.number}</DropdownMenuShortcut>
    )}
  </DropdownMenuItem>
);

const PickerItems = ({
  issues,
  onDone,
  picker,
}: {
  issues: IssueSummary[];
  onDone: () => void;
  picker: Picker;
}) => {
  const queryClient = useQueryClient();
  const { options, writes } = usePicker(picker, issues);
  const labels = picker === "labels";

  const select = (option: PickerOption) => {
    writeIssues(queryClient, writes(option));
  };

  const Item = labels ? LabelItem : OptionItem;

  const item = (option: PickerOption) => (
    <Item
      key={option.value}
      onSelect={() => {
        select(option);
      }}
      option={option}
    />
  );

  const { checked = [], rest = [] } = Object.groupBy(options, (option) =>
    option.checked ? "checked" : "rest"
  );

  return (
    <>
      <MenuFilterInput
        aria-label={pickerTitles[picker]}
        onKeyDown={(event) => {
          const option = options.find(
            (candidate) => candidate.number === Number(event.key)
          );

          if (!labels && event.currentTarget.value === "" && isDigit(event)) {
            event.preventDefault();

            if (option !== undefined) {
              select(option);
              onDone();
            }
          }
        }}
        placeholder={pickerTitles[picker]}
      />
      <Menu.Empty className="text-muted-foreground px-2 py-1.5">
        No matches
      </Menu.Empty>
      <Menu.List>
        {labels && checked.length > 0 ? (
          <>
            {checked.map(item)}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspace labels</DropdownMenuLabel>
              {rest.map(item)}
            </DropdownMenuGroup>
          </>
        ) : (
          options.map(item)
        )}
      </Menu.List>
    </>
  );
};

const PickerSubmenu = ({
  hotkey,
  icon,
  issues,
  label,
  onDone,
  picker,
}: {
  hotkey: Hotkey;
  icon: ReactNode;
  issues: IssueSummary[];
  label: string;
  onDone: () => void;
  picker: Picker;
}) => (
  <Menu.FilterProvider autoHighlight>
    <DropdownMenuSub>
      <DropdownMenuSubTrigger label={label}>
        {icon}
        <span className="flex-1">{label}</span>
        <MenuKeys hotkey={hotkey} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent aria-label={label} className="w-56">
        <PickerItems issues={issues} onDone={onDone} picker={picker} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  </Menu.FilterProvider>
);

const copies: { hotkey?: Hotkey; label: [string, string]; what: IssueCopy }[] =
  [
    {
      hotkey: { keys: ".", mod: true },
      label: ["Copy ID", "Copy IDs"],
      what: "id",
    },
    {
      hotkey: { keys: ",", mod: true, shift: true },
      label: ["Copy URL", "Copy URLs"],
      what: "url",
    },
    { label: ["Copy title", "Copy titles"], what: "title" },
    { label: ["Copy title as link", "Copy titles as links"], what: "link" },
    {
      hotkey: { keys: ".", mod: true, shift: true },
      label: ["Copy git branch name", "Copy git branch names"],
      what: "branch",
    },
  ];

const IssueMenuItems = ({
  issues,
  onDone,
  query,
  touch,
}: {
  issues: IssueSummary[];
  onDone: () => void;
  query: string;
  touch: boolean;
}) => {
  const filtering = query !== "";
  const workspace = useWorkspace();
  const username = useUsername();
  const deletion = useDeleteIssue();
  const single = issues.length === 1 ? issues[0] : undefined;
  const many = issues.length > 1;
  const props = { issues, onDone };

  return (
    <>
      <RootMenuFilter query={query} />
      <Menu.List>
        {touch && single !== undefined ? (
          <>
            <DropdownMenuItem
              label="Select"
              onClick={() => {
                setSelection(toggled(getSelection(), single.id));
              }}
            >
              <SquareCheckIcon />
              Select
            </DropdownMenuItem>
            {filtering ? null : <DropdownMenuSeparator />}
          </>
        ) : null}
        <PickerSubmenu
          {...props}
          hotkey={{ keys: "s" }}
          icon={<ContrastIcon />}
          label="Status"
          picker="status"
        />
        <PickerSubmenu
          {...props}
          hotkey={{ keys: "p" }}
          icon={<ChartNoAxesColumnIncreasingIcon />}
          label="Priority"
          picker="priority"
        />
        <PickerSubmenu
          {...props}
          hotkey={{ keys: "a" }}
          icon={<UserRoundIcon />}
          label="Assignee"
          picker="assignee"
        />
        <PickerSubmenu
          {...props}
          hotkey={{ keys: "l" }}
          icon={<TagIcon />}
          label="Labels"
          picker="labels"
        />
        {filtering ? null : <DropdownMenuSeparator />}
        <Menu.FilterProvider autoHighlight>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger label="Copy">
              <ClipboardIcon />
              <span className="flex-1">Copy</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Copy" className="w-64">
              <MenuFilterInput
                aria-label="Filter copy actions"
                placeholder="Filter…"
              />
              <Menu.List>
                {copies.map((copy) => {
                  const label = copy.label[many ? 1 : 0];

                  return (
                    <DropdownMenuItem
                      key={copy.what}
                      label={label}
                      onClick={() => {
                        copyIssues(issues, copy.what, workspace.slug, username);
                      }}
                    >
                      <span className="flex-1">{label}</span>
                      {copy.hotkey === undefined ? null : (
                        <MenuKeys hotkey={copy.hotkey} />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </Menu.List>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </Menu.FilterProvider>
        {filtering ? null : <DropdownMenuSeparator />}
        <DropdownMenuItem
          label="Delete"
          onClick={() => {
            void deletion.remove(issues);
          }}
        >
          <Trash2Icon />
          <span className="flex-1">Delete</span>
          <MenuKeys hotkey={{ keys: "backspace", mod: true }} />
        </DropdownMenuItem>
      </Menu.List>
    </>
  );
};

const rowOf = (target: EventTarget) =>
  target instanceof Element
    ? target.closest<HTMLElement>("[data-issue]")
    : null;

export const IssueContextMenu = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const [target, setTarget] = useState<{
    issues: IssueSummary[];
    touch: boolean;
  }>({ issues: [], touch: false });

  const issues = useCachedIssues(target.issues);
  const targetRow = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const row = open ? targetRow.current : null;

    if (row !== null) {
      row.dataset["menuTarget"] = "";
    }

    return () => {
      if (row !== null) {
        delete row.dataset["menuTarget"];
      }
    };
  }, [open]);

  useEffect(() => {
    setMenuCloser(() => {
      setOpen(false);
    });

    return () => {
      setMenuCloser(null);
    };
  }, []);

  const aim = (event: {
    preventBaseUIHandler: () => void;
    target: EventTarget;
  }) => {
    const row = rowOf(event.target);
    const id = row?.dataset["issue"];
    const issue = id === undefined ? null : findIssue(queryClient, id);

    if (row === null || id === undefined || issue === null) {
      event.preventBaseUIHandler();

      return;
    }

    targetRow.current = row;
    row.focus({ preventScroll: true });
    setTarget({
      issues: getSelection().ids.has(id)
        ? selectedIssues(queryClient)
        : [issue],
      touch: isCoarsePointer(),
    });
  };

  return (
    <Menu.FilterProvider autoHighlight onValueChange={setQuery} value={query}>
      <ContextMenu onOpenChange={setOpen} open={open && issues.length > 0}>
        <ContextMenuTrigger
          className="contents"
          onContextMenu={aim}
          onTouchStart={aim}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent aria-label="Issue actions" className="w-45">
          {issues.length > 0 ? (
            <IssueMenuItems
              query={query}
              issues={issues}
              onDone={() => {
                setOpen(false);
              }}
              touch={target.touch}
            />
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </Menu.FilterProvider>
  );
};
