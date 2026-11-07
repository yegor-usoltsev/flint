import {
  KanbanIcon,
  ListIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";

import { useCreateIssue } from "~/components/create-issue";
import { FilterItems, FilterMenu } from "~/components/issue-filters";
import type { FilterProps } from "~/components/issue-filters";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { isFiltered, rememberView } from "~/lib/issue-view";
import type { ViewKind } from "~/lib/issue-view";
import { useCommands } from "~/lib/use-hotkey";

interface Choice<Value extends string> {
  label: string;
  value: Value;
}

const completedOptions = [
  { label: "Past 2 weeks", value: "recent" },
  { label: "All", value: "all" },
] as const satisfies readonly Choice<string>[];

const layouts = [
  { icon: ListIcon, label: "List", value: "list" },
  { icon: KanbanIcon, label: "Board", value: "board" },
] as const;

const isLayout = (value: unknown): value is ViewKind =>
  layouts.some((layout) => layout.value === value);

export interface ListControls<Order extends string> {
  closed: boolean;
  filter: FilterProps;
  onClosed: (all: boolean) => void;
  onOrder: (order: Order) => void;
  order: Order;
  orders: readonly Choice<Order>[];
  view: ViewKind;
  viewKey: string;
}

const OptionSelect = <Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly Choice<Value>[];
  value: Value;
}) => (
  <div className="flex h-8 items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <Select
      items={options}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next);

        if (option !== undefined) {
          onChange(option.value);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label={label} className="w-34" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

const DisplayOptions = <Order extends string>({
  closed,
  onClosed,
  onOrder,
  order,
  orders,
  view,
  viewKey,
}: ListControls<Order>) => {
  const current = layouts.find((layout) => layout.value === view) ?? layouts[0];

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={`Display options, ${current.label}`}
                  size="pill"
                  variant="ghost"
                />
              }
            />
          }
        >
          <current.icon data-icon="inline-start" />
          {current.label}
        </TooltipTrigger>
        <TooltipContent side="bottom">Display options</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" aria-label="Display options" className="w-76">
        <div className="grid grid-cols-2 gap-2">
          {layouts.map((layout) => (
            <button
              aria-keyshortcuts="Meta+B"
              aria-pressed={layout.value === view}
              className="text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:border-input aria-pressed:text-foreground focus-visible:ring-ring hit-area relative flex h-8 items-center justify-center gap-1.5 rounded-lg border font-medium outline-none focus-visible:ring-2"
              key={layout.value}
              onClick={() => {
                rememberView(viewKey, layout.value);
              }}
              type="button"
            >
              <layout.icon aria-hidden className="size-3.5" />
              {layout.label}
            </button>
          ))}
        </div>
        {orders.length > 1 ? (
          <OptionSelect
            label="Ordering"
            onChange={onOrder}
            options={orders}
            value={order}
          />
        ) : null}
        <OptionSelect
          label="Completed issues"
          onChange={(completed) => {
            onClosed(completed === "all");
          }}
          options={completedOptions}
          value={closed ? "all" : "recent"}
        />
      </PopoverContent>
    </Popover>
  );
};

const RadioSub = <Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly Choice<Value>[];
  value: Value;
}) => (
  <DropdownMenuSub>
    <DropdownMenuSubTrigger>
      {label}
      <DropdownMenuShortcut>
        {options.find((option) => option.value === value)?.label}
      </DropdownMenuShortcut>
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="min-w-40">
      <DropdownMenuRadioGroup
        onValueChange={(next) => {
          const option = options.find((item) => item.value === next);

          if (option !== undefined) {
            onChange(option.value);
          }
        }}
        value={value}
      >
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
);

const ViewMenu = <Order extends string>({
  onOpenChange,
  open,
  ...controls
}: ListControls<Order> & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const { closed, filter, onClosed, onOrder, order, orders, view, viewKey } =
    controls;

  const filtered = isFiltered(filter.values, filter.keys);

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={filtered ? "View, filtered" : "View"}
            className="relative"
            size="icon-round"
            variant="ghost"
          />
        }
      >
        <SlidersHorizontalIcon />
        {filtered ? (
          <span
            aria-hidden
            className="bg-primary absolute top-0.5 right-0.5 size-2 rounded-full"
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Filter</DropdownMenuLabel>
          <FilterItems {...filter} />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(next) => {
              if (isLayout(next)) {
                rememberView(viewKey, next);
              }
            }}
            value={view}
          >
            {layouts.map((layout) => (
              <DropdownMenuRadioItem key={layout.value} value={layout.value}>
                <layout.icon />
                {layout.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {orders.length > 1 ? (
          <RadioSub
            label="Ordering"
            onChange={onOrder}
            options={orders}
            value={order}
          />
        ) : null}
        <RadioSub
          label="Completed"
          onChange={(completed) => {
            onClosed(completed === "all");
          }}
          options={completedOptions}
          value={closed ? "all" : "recent"}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const wide = () => window.matchMedia("(min-width: 48rem)").matches;

export const IssueListActions = <Order extends string>(
  controls: ListControls<Order>
) => {
  const [filtering, setFiltering] = useState(false);
  const [viewing, setViewing] = useState(false);
  const createIssue = useCreateIssue();
  const { view, viewKey } = controls;

  useCommands([
    {
      group: "View",
      hotkey: { keys: "f" },
      id: "filter",
      label: "Filter…",
      run: () => {
        if (wide()) {
          setFiltering(true);
        } else {
          setViewing(true);
        }
      },
    },
    {
      group: "View",
      hotkey: { keys: "b", mod: true },
      id: "toggle-view",
      label: view === "list" ? "Switch to board" : "Switch to list",
      run: () => {
        rememberView(viewKey, view === "list" ? "board" : "list");
      },
    },
  ]);

  return (
    <>
      <div className="flex items-center gap-1 max-md:hidden">
        <FilterMenu
          {...controls.filter}
          onOpenChange={setFiltering}
          open={filtering}
        />
        <DisplayOptions {...controls} />
        <Button
          aria-keyshortcuts="C"
          onClick={() => {
            createIssue();
          }}
          size="pill"
          variant="ghost"
        >
          <PlusIcon data-icon="inline-start" />
          New issue
        </Button>
      </div>
      <div className="flex items-center gap-2 md:hidden">
        <ViewMenu {...controls} onOpenChange={setViewing} open={viewing} />
        <Button
          aria-keyshortcuts="C"
          aria-label="New issue"
          onClick={() => {
            createIssue();
          }}
          size="icon-round"
        >
          <PlusIcon />
        </Button>
      </div>
    </>
  );
};
