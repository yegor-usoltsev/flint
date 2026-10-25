import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { PlusIcon, TagIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { LabelChip } from "~/components/issue-parts";
import { PriorityIcon } from "~/components/priority-icon";
import { StatusIcon } from "~/components/status-icon";
import { Swatch } from "~/components/swatch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { UserAvatar } from "~/components/user-avatar";
import type {
  IssueSummary,
  Label,
  Member,
  ProjectDetail,
} from "~/lib/api-types";
import {
  assigneeOptions,
  labelOptions,
  priorityOptions,
  priorityOrder,
  statusOptions,
  useCreateLabel,
} from "~/lib/issue-options";
import type { PropertyOption } from "~/lib/issue-options";
import { priorities } from "~/lib/priorities";
import { labelsQuery, membersQuery } from "~/lib/queries";
import type { LabelChanges } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

type Option = PropertyOption;

const optionNumber = (index: number, zeroBased: boolean) => {
  const number = zeroBased ? index : index + 1;

  return number <= 9 ? number : undefined;
};

const Picker = ({
  label,
  multiple = false,
  onCreate,
  onSelect,
  options,
  selected,
  trigger,
  zeroBased = false,
}: {
  label: string;
  multiple?: boolean;
  onCreate?: (name: string) => void;
  onSelect: (value: string) => void;
  options: Option[];
  selected: string[];
  trigger: ReactElement;
  zeroBased?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const name = query.trim();
  const chosen = new Set(selected);

  const exists = options.some(
    (option) => option.label.toLowerCase() === name.toLowerCase()
  );

  const creatable = onCreate !== undefined && name !== "" && !exists;

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
      }}
      open={open}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        aria-label={label}
        // oxlint-disable-next-line shadcn/no-restyle -- Command brings its own padding around the input and list.
        className="w-64 gap-0 p-0"
      >
        <Command
          onKeyDown={(event) => {
            const digit = /^\d$/u.test(event.key) && !multiple && query === "";
            const modified = event.metaKey || event.ctrlKey || event.altKey;

            if (digit && !modified && !event.nativeEvent.isComposing) {
              event.preventDefault();

              const option = options.find(
                (_item, index) =>
                  optionNumber(index, zeroBased) === Number(event.key)
              );

              if (option !== undefined) {
                onSelect(option.value);
                setOpen(false);
              }
            }
          }}
        >
          <CommandInput
            aria-label={label}
            onValueChange={setQuery}
            placeholder={`${label}…`}
            value={query}
          />
          <CommandList>
            {creatable ? null : <CommandEmpty>No matches</CommandEmpty>}
            <CommandGroup>
              {options.map((option, index) => (
                <CommandItem
                  data-checked={chosen.has(option.value)}
                  key={option.value}
                  keywords={[option.label, option.keywords ?? ""]}
                  onSelect={() => {
                    onSelect(option.value);

                    if (!multiple) {
                      setOpen(false);
                    }
                  }}
                  value={option.value}
                >
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                  {multiple ? null : (
                    <CommandShortcut>
                      {optionNumber(index, zeroBased)}
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {creatable ? (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  onSelect={() => {
                    onCreate?.(name);
                    setQuery("");
                  }}
                  value={`create:${name}`}
                >
                  <PlusIcon />
                  <span className="truncate">Create label “{name}”</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const MemberAvatar = ({ member }: { member: Member }) => (
  <UserAvatar
    avatarUrl={member.avatarUrl}
    className="size-4"
    name={member.displayName}
  />
);

const IconSlot = ({ children }: { children: ReactNode }) => (
  <span className="flex size-4 shrink-0 items-center justify-center">
    {children}
  </span>
);

type Layout = "pills" | "rail";

const triggerClass = {
  pills:
    "hit-area relative flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-accent dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:data-popup-open:bg-input/50",
  rail: "-ml-1.5 flex min-h-7 max-w-full min-w-0 items-center gap-2 rounded-full py-0.5 pr-2.5 pl-1.5 text-left font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-accent",
} satisfies Record<Layout, string>;

const Section = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <section className="flex flex-col items-start gap-1">
    <h2 className="text-muted-foreground mb-1.5 leading-4 font-medium">
      {title}
    </h2>
    {children}
  </section>
);

const Text = ({
  children,
  compact,
  muted = false,
}: {
  children: ReactNode;
  compact: boolean;
  muted?: boolean;
}) => (
  <span
    className={cn(
      "truncate",
      muted && "text-muted-foreground",
      compact && "max-sm:hidden"
    )}
  >
    {children}
  </span>
);

const LabelSummary = ({
  labels,
  pills,
}: {
  labels: Label[];
  pills: boolean;
}) => {
  if (!pills) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <LabelChip key={label.id} label={label} />
        ))}
        <PlusIcon className="text-muted-foreground size-3.5" />
      </span>
    );
  }

  return (
    <>
      <span className="flex -space-x-0.5">
        {labels.map((label) => (
          <Swatch className="size-2" color={label.color} key={label.id} />
        ))}
      </span>
      {labels.length === 1 ? (
        <span className="truncate">{labels[0]?.name}</span>
      ) : (
        <span>
          {labels.length}
          <span className="max-sm:hidden"> labels</span>
        </span>
      )}
    </>
  );
};

export const IssueProperties = ({
  issue,
  layout,
  onChange,
  project,
}: {
  issue: IssueSummary;
  layout: Layout;
  onChange: (
    patch: Partial<Pick<IssueSummary, "assigneeId" | "priority" | "statusId">> &
      LabelChanges
  ) => void;
  project: ProjectDetail;
}) => {
  const workspace = useWorkspace();
  const members = useQuery(membersQuery(workspace.slug)).data ?? [];
  const labels = useQuery(labelsQuery(workspace.slug)).data ?? [];
  const status = project.statuses.find((item) => item.id === issue.statusId);
  const assignee = members.find((member) => member.userId === issue.assigneeId);
  const pills = layout === "pills";

  const labelIds = new Set(issue.labelIds);
  const issueLabels = labels.filter((label) => labelIds.has(label.id));

  const createLabel = useCreateLabel((label) => {
    onChange({ addLabelIds: [label.id] });
  });

  const button = (name: string, content: ReactNode) => (
    <button aria-label={name} className={triggerClass[layout]} type="button">
      {content}
    </button>
  );

  const toggleLabel = (id: string) => {
    onChange(
      issue.labelIds.includes(id)
        ? { removeLabelIds: [id] }
        : { addLabelIds: [id] }
    );
  };

  const statusPicker = (
    <Picker
      label="Change status"
      onSelect={(statusId) => {
        onChange({ statusId });
      }}
      options={statusOptions(project.statuses)}
      selected={[issue.statusId]}
      trigger={button(
        `Status: ${status?.name ?? "Unknown"}`,
        <>
          {status === undefined ? null : (
            <IconSlot>
              <StatusIcon category={status.category} color={status.color} />
            </IconSlot>
          )}
          <span className="truncate">{status?.name ?? "Unknown"}</span>
        </>
      )}
    />
  );

  const priorityPicker = (
    <Picker
      label="Change priority"
      zeroBased
      onSelect={(value) => {
        onChange({ priority: priorityOrder[Number(value)] ?? 0 });
      }}
      options={priorityOptions}
      selected={[String(issue.priority)]}
      trigger={button(
        `Priority: ${priorities[issue.priority]}`,
        <>
          <IconSlot>
            <PriorityIcon priority={issue.priority} />
          </IconSlot>
          {issue.priority === 0 ? (
            <Text compact={pills} muted>
              {pills ? "Priority" : "Set priority"}
            </Text>
          ) : (
            <Text compact={pills}>{priorities[issue.priority]}</Text>
          )}
        </>
      )}
    />
  );

  const assigneePicker = (
    <Picker
      label="Assign to"
      zeroBased
      onSelect={(value) => {
        onChange({ assigneeId: value === "none" ? null : value });
      }}
      options={assigneeOptions(members)}
      selected={[issue.assigneeId ?? "none"]}
      trigger={button(
        `Assignee: ${assignee?.displayName ?? "none"}`,
        assignee === undefined ? (
          <>
            <UserRoundIcon className="text-muted-foreground size-4 shrink-0" />
            <Text compact={pills} muted>
              {issue.assigneeId === null && !pills ? "Assign" : "Assignee"}
            </Text>
          </>
        ) : (
          <>
            <MemberAvatar member={assignee} />
            <Text compact={pills}>{assignee.displayName}</Text>
          </>
        )
      )}
    />
  );

  const labelsPicker = (
    <Picker
      label="Change labels"
      multiple
      onCreate={(name) => {
        createLabel.mutate(name);
      }}
      onSelect={toggleLabel}
      options={labelOptions(labels)}
      selected={issue.labelIds}
      trigger={button(
        `Labels: ${issueLabels.map((label) => label.name).join(", ") || "none"}`,
        issueLabels.length === 0 ? (
          <>
            <TagIcon className="text-muted-foreground size-4 shrink-0" />
            <Text compact={false} muted>
              {pills ? "Labels" : "Add label"}
            </Text>
          </>
        ) : (
          <LabelSummary labels={issueLabels} pills={pills} />
        )
      )}
    />
  );

  if (pills) {
    return (
      <>
        {statusPicker}
        {priorityPicker}
        {assigneePicker}
        {labelsPicker}
      </>
    );
  }

  return (
    <>
      <Section title="Properties">
        {statusPicker}
        {priorityPicker}
        {assigneePicker}
      </Section>
      <Section title="Labels">{labelsPicker}</Section>
    </>
  );
};
