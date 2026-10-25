import { useQuery } from "@tanstack/react-query";
import { ListFilterIcon, UserRoundIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PriorityIcon } from "~/components/priority-icon";
import { Keys } from "~/components/shortcuts-dialog";
import { StatusIcon } from "~/components/status-icon";
import { Swatch } from "~/components/swatch";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/user-avatar";
import type { ProjectDetail } from "~/lib/api-types";
import { filterKeys } from "~/lib/issue-view";
import type { FilterKey, IssueSearch } from "~/lib/issue-view";
import { priorities } from "~/lib/priorities";
import type { Priority } from "~/lib/priorities";
import { labelsQuery, membersQuery } from "~/lib/queries";
import { useWorkspace } from "~/lib/use-workspace";

interface Option {
  icon: ReactNode;
  label: string;
  value: number | string;
}

const filterNames = {
  assignee: "Assignee",
  label: "Label",
  priority: "Priority",
  status: "Status",
} satisfies Record<FilterKey, string>;

const priorityOrder: Priority[] = [1, 2, 3, 4, 0];

const useFilterOptions = (
  project: ProjectDetail
): Record<FilterKey, Option[]> => {
  const workspace = useWorkspace();
  const members = useQuery(membersQuery(workspace.slug)).data ?? [];
  const labels = useQuery(labelsQuery(workspace.slug)).data ?? [];

  return {
    assignee: [
      {
        icon: <UserRoundIcon className="text-muted-foreground size-3.5" />,
        label: "No assignee",
        value: "none",
      },
      ...members.flatMap((member) =>
        member.userId === null
          ? []
          : [
              {
                icon: (
                  <UserAvatar
                    avatarUrl={member.avatarUrl}
                    className="size-4"
                    name={member.displayName}
                  />
                ),
                label: member.displayName,
                value: member.userId,
              },
            ]
      ),
    ],
    label: labels.map((label) => ({
      icon: <Swatch color={label.color} />,
      label: label.name,
      value: label.id,
    })),
    priority: priorityOrder.map((priority) => ({
      icon: <PriorityIcon priority={priority} />,
      label: priorities[priority],
      value: priority,
    })),
    status: project.statuses.map((status) => ({
      icon: <StatusIcon category={status.category} color={status.color} />,
      label: status.name,
      value: status.id,
    })),
  };
};

type ChangeFilter = (key: FilterKey, values: (number | string)[]) => void;

const toggle = <Value,>(values: Value[], value: Value, on: boolean) =>
  on ? [...values, value] : values.filter((item) => item !== value);

export const FilterMenu = ({
  onChange,
  onOpenChange,
  open,
  project,
  search,
}: {
  onChange: ChangeFilter;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: ProjectDetail;
  search: IssueSearch;
}) => {
  const options = useFilterOptions(project);

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-keyshortcuts="F"
                  aria-label="Filter"
                  size="icon-round"
                  variant="ghost"
                />
              }
            />
          }
        >
          <ListFilterIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Filter <Keys hotkey={{ keys: "f" }} />
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        {filterKeys.map((key) => {
          const selected = new Set<number | string>(search[key]);

          return (
            <DropdownMenuSub key={key}>
              <DropdownMenuSubTrigger>
                {filterNames[key]}
                {selected.size > 0 ? (
                  <DropdownMenuShortcut>{selected.size}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 min-w-48">
                {options[key].map((option) => (
                  <DropdownMenuCheckboxItem
                    checked={selected.has(option.value)}
                    closeOnClick={false}
                    key={option.value}
                    onCheckedChange={(checked) => {
                      onChange(
                        key,
                        toggle([...selected], option.value, checked)
                      );
                    }}
                  >
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const FilterChips = ({
  onChange,
  onClear,
  project,
  search,
}: {
  onChange: ChangeFilter;
  onClear: () => void;
  project: ProjectDetail;
  search: IssueSearch;
}) => {
  const options = useFilterOptions(project);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
      {filterKeys.map((key) => {
        const selected = new Set<number | string>(search[key]);

        const chosen = options[key].filter((option) =>
          selected.has(option.value)
        );

        return selected.size === 0 ? null : (
          <span
            className="bg-surface-2 flex h-7 max-w-full items-center rounded-md border text-xs"
            key={key}
          >
            <span className="text-muted-foreground pl-2">
              {filterNames[key]}
            </span>
            <span className="text-muted-foreground px-1">
              {selected.size > 1 ? "is any of" : "is"}
            </span>
            <span className="flex min-w-0 items-center gap-1 pr-1">
              {chosen.length === 1 ? chosen[0]?.icon : null}
              <span className="truncate font-medium">
                {chosen.length > 2
                  ? `${chosen.length} ${filterNames[key].toLowerCase()}s`
                  : chosen.map((option) => option.label).join(", ")}
              </span>
            </span>
            <button
              aria-label={`Clear ${filterNames[key].toLowerCase()} filter`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-full items-center rounded-r-md border-l px-1.5 outline-none focus-visible:ring-2"
              onClick={() => {
                onChange(key, []);
              }}
              type="button"
            >
              <XIcon className="size-3.5" />
            </button>
          </span>
        );
      })}
      <Button onClick={onClear} size="xs" variant="ghost">
        Clear
      </Button>
    </div>
  );
};
