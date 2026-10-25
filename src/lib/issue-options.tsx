import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { UserRoundIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PriorityIcon } from "~/components/priority-icon";
import { StatusIcon } from "~/components/status-icon";
import { Swatch } from "~/components/swatch";
import { UserAvatar } from "~/components/user-avatar";
import { api } from "~/lib/api";
import type { IssueSummary, Label, Member, Status } from "~/lib/api-types";
import { colors } from "~/lib/colors";
import { notifyError } from "~/lib/notify";
import { priorities } from "~/lib/priorities";
import type { Priority } from "~/lib/priorities";
import { labelsQuery, membersQuery, projectQuery } from "~/lib/queries";
import type { IssuePatch } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

export interface PropertyOption {
  icon: ReactNode;
  keywords?: string;
  label: string;
  value: string;
}

export const priorityOrder: Priority[] = [0, 1, 2, 3, 4];

export const statusOptions = (statuses: Status[]): PropertyOption[] =>
  statuses.map((status) => ({
    icon: <StatusIcon category={status.category} color={status.color} />,
    label: status.name,
    value: status.id,
  }));

export const priorityOptions: PropertyOption[] = priorityOrder.map(
  (priority) => ({
    icon: <PriorityIcon priority={priority} />,
    label: priorities[priority],
    value: String(priority),
  })
);

export const assigneeOptions = (members: Member[]): PropertyOption[] => [
  {
    icon: <UserRoundIcon className="text-muted-foreground" />,
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
            keywords: member.username,
            label: member.displayName,
            value: member.userId,
          },
        ]
  ),
];

export const labelOptions = (labels: Label[]): PropertyOption[] =>
  labels.map((label) => ({
    icon: <Swatch color={label.color} />,
    label: label.name,
    value: label.id,
  }));

const colorFor = (name: string) => {
  let sum = 0;

  for (let index = 0; index < name.length; index += 1) {
    sum += name.codePointAt(index) ?? 0;
  }

  return colors[sum % colors.length] ?? "gray";
};

export const useCreateLabel = (onCreated: (label: Label) => void) => {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const { queryKey } = labelsQuery(workspace.slug);

  return useMutation({
    mutationFn: async (name: string) =>
      await api<Label>(`/workspaces/${workspace.slug}/labels`, {
        body: {
          color: colorFor(name),
          name,
        },
        method: "POST",
      }),
    onError: notifyError("Could not create the label"),
    onSuccess: (label) => {
      queryClient.setQueryData<Label[]>(queryKey, (current) => [
        ...(current ?? []),
        label,
      ]);
      onCreated(label);
    },
  });
};

export type Picker = "assignee" | "labels" | "priority" | "status";

export interface PickerOption extends PropertyOption {
  checked: boolean;
  number: number | undefined;
}

export interface IssueWrite {
  issue: IssueSummary;
  patch: IssuePatch;
}

export const pickerTitles = {
  assignee: "Assign to…",
  labels: "Change or add labels…",
  priority: "Change priority to…",
  status: "Change status…",
} satisfies Record<Picker, string>;

export const projectKeyOf = (issue: IssueSummary) =>
  issue.key.split("-")[0] ?? "";

const statusIn = (
  statuses: Map<string, Status[]>,
  issue: IssueSummary,
  name: string | undefined
) => statuses.get(issue.projectId)?.find((status) => status.name === name);

const currentValue = (
  picker: Exclude<Picker, "labels">,
  issue: IssueSummary,
  statuses: Map<string, Status[]>
) =>
  ({
    assignee: issue.assigneeId ?? "none",
    priority: String(issue.priority),
    status: [...statuses.values()]
      .flat()
      .find((status) => status.id === issue.statusId)?.name,
  })[picker];

export const pickerChecked = (
  picker: Picker,
  issues: IssueSummary[],
  option: PropertyOption,
  statuses: Map<string, Status[]>
) => {
  if (picker === "labels") {
    return (
      issues.length > 0 &&
      issues.every((issue) => issue.labelIds.includes(option.value))
    );
  }

  const value = picker === "status" ? option.label : option.value;

  return (
    issues.length > 0 &&
    issues.every((issue) => currentValue(picker, issue, statuses) === value)
  );
};

const toggledLabels = (issues: IssueSummary[], labelId: string) => {
  const everywhere = issues.every((issue) => issue.labelIds.includes(labelId));

  return issues.flatMap((issue): IssueWrite[] => {
    const has = issue.labelIds.includes(labelId);

    if (everywhere) {
      return [
        {
          issue,
          patch: { removeLabelIds: [labelId] },
        },
      ];
    }

    return has ? [] : [{ issue, patch: { addLabelIds: [labelId] } }];
  });
};

const priorityOf = (value: string) =>
  priorityOrder.find((priority) => String(priority) === value) ?? 0;

export const pickerWrites = (
  picker: Picker,
  issues: IssueSummary[],
  option: PropertyOption,
  statuses: Map<string, Status[]>
): IssueWrite[] => {
  if (picker === "labels") {
    return toggledLabels(issues, option.value);
  }

  return issues.flatMap((issue): IssueWrite[] => {
    if (picker === "status") {
      const status = statusIn(statuses, issue, option.label);

      return status === undefined || status.id === issue.statusId
        ? []
        : [{ issue, patch: { statusId: status.id } }];
    }

    if (currentValue(picker, issue, statuses) === option.value) {
      return [];
    }

    return [
      {
        issue,
        patch:
          picker === "priority"
            ? { priority: priorityOf(option.value) }
            : { assigneeId: option.value === "none" ? null : option.value },
      },
    ];
  });
};

export const usePicker = (picker: Picker | null, issues: IssueSummary[]) => {
  const workspace = useWorkspace();
  const keys = [...new Set(issues.map(projectKeyOf))];

  const projects = useQueries({
    queries: keys.map((key) => ({
      ...projectQuery(key),
      enabled: picker === "status",
    })),
  });

  const members = useQuery({
    ...membersQuery(workspace.slug),
    enabled: picker === "assignee",
  });

  const labels = useQuery({
    ...labelsQuery(workspace.slug),
    enabled: picker === "labels",
  });

  const statuses = new Map(
    projects.flatMap((query) =>
      query.data === undefined ? [] : [[query.data.id, query.data.statuses]]
    )
  );

  const lists = {
    assignee: () => assigneeOptions(members.data ?? []),
    labels: () => labelOptions(labels.data ?? []),
    priority: () => priorityOptions,
    status: () => statusOptions(projects[0]?.data?.statuses ?? []),
  } satisfies Record<Picker, () => PropertyOption[]>;

  const zeroBased = picker === "assignee" || picker === "priority";

  const options =
    picker === null
      ? []
      : lists[picker]().map((option, index): PickerOption => {
          const number = zeroBased ? index : index + 1;

          return {
            ...option,
            checked: pickerChecked(picker, issues, option, statuses),
            number: number <= 9 ? number : undefined,
          };
        });

  return {
    options,
    writes: (option: PropertyOption) =>
      picker === null ? [] : pickerWrites(picker, issues, option, statuses),
  };
};
