import { cn } from "cn";
import { CheckIcon, UserRoundIcon } from "lucide-react";
import type { ReactElement } from "react";

import { Swatch } from "~/components/swatch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/user-avatar";
import type {
  CommitStatusState,
  IssueSummary,
  Label,
  Member,
  PullRequestState,
  Status,
} from "~/lib/api-types";
import { ciStyles, pullRequestStyles } from "~/lib/pull-requests";

export interface IssueLookup {
  labels: Map<string, Label>;
  members: Map<string, Member>;
  statuses: Map<string, Status>;
}

export const CheckBox = ({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) => (
  <span
    aria-hidden
    className={cn(
      "border-muted-foreground/60 flex size-3.5 shrink-0 items-center justify-center rounded-xs border",
      checked && "bg-primary border-primary text-primary-foreground",
      className
    )}
  >
    {checked ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
  </span>
);

export const Hint = ({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

export const LabelChip = ({ label }: { label: Label }) => (
  <Hint label={label.name}>
    <span className="text-muted-foreground border-hairline inline-flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs">
      <Swatch className="size-2" color={label.color} />
      <span className="truncate">{label.name}</span>
    </span>
  </Hint>
);

export const IssueLabels = ({
  issue,
  lookup,
  max = Infinity,
}: {
  issue: IssueSummary;
  lookup: IssueLookup;
  max?: number;
}) => {
  const labels = issue.labelIds.flatMap((id) => lookup.labels.get(id) ?? []);
  const hidden = labels.length - max;

  return (
    <>
      {labels.slice(0, max).map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {hidden > 0 ? (
        <Hint
          label={labels
            .slice(max)
            .map((label) => label.name)
            .join(", ")}
        >
          <span className="text-muted-foreground border-hairline inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs tabular-nums">
            +{hidden}
          </span>
        </Hint>
      ) : null}
    </>
  );
};

export const Checklist = ({ issue }: { issue: IssueSummary }) => {
  if (issue.checklistTotal === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "shrink-0 text-xs tabular-nums",
        issue.checklistDone === issue.checklistTotal
          ? "text-foreground"
          : "text-muted-foreground"
      )}
    >
      <span className="sr-only">Checklist </span>
      {issue.checklistDone}/{issue.checklistTotal}
    </span>
  );
};

export const Assignee = ({
  className,
  issue,
  lookup,
}: {
  className?: string;
  issue: IssueSummary;
  lookup: IssueLookup;
}) => {
  if (issue.assigneeId === null) {
    return (
      <span
        className={cn(
          "text-muted-foreground/60 flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed",
          className
        )}
      >
        <UserRoundIcon aria-hidden className="size-3" />
        <span className="sr-only">No assignee</span>
      </span>
    );
  }

  const member = lookup.members.get(issue.assigneeId);
  const name = member?.displayName ?? "?";

  return (
    <Hint label={`Assigned to ${name}`}>
      <span className={cn("shrink-0", className)}>
        <UserAvatar
          avatarUrl={member?.avatarUrl ?? ""}
          className="size-5"
          name={name}
        />
        <span className="sr-only">Assigned to {name}</span>
      </span>
    </Hint>
  );
};

export const PullRequestIcon = ({
  className,
  state,
}: {
  className?: string;
  state: PullRequestState | null;
}) => {
  if (state === null) {
    return null;
  }

  const { color, icon: Icon, label } = pullRequestStyles[state];

  return (
    <span
      className={cn("text-swatch flex shrink-0", className)}
      data-color={color}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">Pull request {label.toLowerCase()}</span>
    </span>
  );
};

export const CiIcon = ({
  className,
  state,
}: {
  className?: string;
  state: CommitStatusState | null;
}) => {
  if (state === null) {
    return null;
  }

  const { color, icon: Icon, summary } = ciStyles[state];

  return (
    <Hint label={summary}>
      <span
        className={cn("text-swatch flex shrink-0", className)}
        data-color={color}
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="sr-only">{summary}</span>
      </span>
    </Hint>
  );
};
