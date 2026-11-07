import { cn } from "cn";
import {
  ChevronRightIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { CiIcon, PullRequestIcon } from "~/components/issue-parts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { CommitCheck, GitLink, Issue } from "~/lib/api-types";
import { formatRelative } from "~/lib/issue-view";
import {
  checksSummary,
  ciStyles,
  developmentSummary,
  isWebUrl,
  newPullRequestUrl,
  pullRequestLabel,
  settledChecks,
} from "~/lib/pull-requests";

const shownCommits = 3;

const ExternalLink = ({ children, ...props }: ComponentProps<"a">) => (
  <a
    {...props}
    className="truncate hover:underline"
    rel="noopener noreferrer"
    target="_blank"
  >
    {children}
  </a>
);

const CheckRow = ({ check }: { check: CommitCheck }) => {
  const { color, icon: Icon, label } = ciStyles[check.state];

  return (
    <li className="flex h-6 min-w-0 items-center gap-1.5 text-xs">
      <span className="text-swatch flex shrink-0" data-color={color}>
        <Icon aria-hidden className="size-3" />
        <span className="sr-only">{label}:</span>
      </span>
      {isWebUrl(check.targetUrl) ? (
        <a
          className="hit-area relative shrink-0 truncate font-medium hover:underline"
          href={check.targetUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {check.context}
        </a>
      ) : (
        <span className="shrink-0 truncate font-medium">{check.context}</span>
      )}
      {check.description === "" ? null : (
        <span className="text-muted-foreground min-w-0 truncate">
          {check.description}
        </span>
      )}
    </li>
  );
};

const Checks = ({
  checks,
  current,
}: {
  checks: CommitCheck[];
  current: boolean;
}) => {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (current && !settledChecks(checks));

  if (checks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <button
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring hit-area relative flex h-6 w-fit items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-2"
        onClick={() => {
          setToggled(!open);
        }}
        type="button"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
        {checksSummary(checks)}
      </button>
      {open ? (
        <ul aria-label="Checks" className="flex flex-col pl-4">
          {checks.map((check) => (
            <CheckRow check={check} key={check.context} />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const LinkRow = ({
  action,
  icon,
  link,
  meta,
  muted = false,
}: {
  action?: ReactNode;
  icon: ReactNode;
  link: GitLink;
  meta: string;
  muted?: boolean;
}) => (
  <li className="hover:bg-accent/60 -mx-2 flex min-h-11 items-start gap-2.5 rounded-md px-2 py-1.5 md:min-h-0">
    <span className="text-muted-foreground mt-0.5 flex shrink-0">{icon}</span>
    <span className="flex min-w-0 flex-1 flex-col">
      {muted ? (
        <span className="text-muted-foreground truncate line-through">
          {link.title}
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<ExternalLink href={link.url} />}>
            {link.title}
          </TooltipTrigger>
          <TooltipContent className="max-w-80 break-words" side="left">
            {link.title}
          </TooltipContent>
        </Tooltip>
      )}
      <span className="text-muted-foreground flex min-w-0 gap-1 text-xs">
        <span className="truncate">{meta}</span>
        {action}
      </span>
      <Checks
        checks={link.checks}
        current={
          link.kind === "pull_request" || link.headSha === link.externalId
        }
      />
    </span>
    <CiIcon className="mt-0.5" state={link.ciState} />
  </li>
);

const PullRequestRow = ({ link }: { link: GitLink }) => {
  const state = link.state === "deleted" ? null : link.state;

  return (
    <LinkRow
      icon={<PullRequestIcon state={state ?? "open"} />}
      link={link}
      meta={[
        `${link.repo} #${link.externalId}`,
        state === null ? null : pullRequestLabel(state),
        link.authorLogin,
      ]
        .filter((part) => part !== null)
        .join(" · ")}
    />
  );
};

const Group = ({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count: number;
  title: string;
}) => (
  <div className="flex flex-col">
    <h3
      className={cn(
        "text-muted-foreground py-1 text-xs",
        count === 1 && "sr-only"
      )}
    >
      {title}
    </h3>
    <ul className="flex flex-col">{children}</ul>
  </div>
);

const LeadIcon = ({ lead }: { lead: GitLink }) => {
  if (lead.kind === "pull_request") {
    return (
      <PullRequestIcon
        state={
          lead.state === null || lead.state === "deleted" ? "open" : lead.state
        }
      />
    );
  }

  return lead.kind === "branch" ? (
    <GitBranchIcon aria-hidden className="size-3.5" />
  ) : (
    <GitCommitHorizontalIcon aria-hidden className="size-3.5" />
  );
};

const SummaryButton = ({
  details,
  expanded,
  links,
  onToggle,
}: {
  details: string;
  expanded: boolean;
  links: GitLink[];
  onToggle: (expanded: boolean) => void;
}) => {
  const summary = developmentSummary(links);

  return (
    <button
      aria-controls={expanded ? details : undefined}
      aria-expanded={expanded}
      className="hover:bg-accent/60 focus-visible:ring-ring -mx-2 flex h-11 items-center gap-2.5 rounded-md px-2 text-left outline-none focus-visible:ring-2"
      onClick={() => {
        onToggle(!expanded);
      }}
      type="button"
    >
      {summary === null ? null : (
        <>
          <span aria-hidden className="text-muted-foreground flex shrink-0">
            <LeadIcon lead={summary.lead} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{summary.text}</span>
            {summary.checks === null ? null : (
              <span className="text-muted-foreground"> · {summary.checks}</span>
            )}
          </span>
        </>
      )}
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "text-muted-foreground size-4 shrink-0 transition-transform duration-(--duration-fast) motion-reduce:transition-none",
          expanded && "rotate-90"
        )}
      />
    </button>
  );
};

export const IssueDevelopment = ({
  collapsible = false,
  issue,
}: {
  collapsible?: boolean;
  issue: Issue;
}) => {
  const heading = useId();
  const details = useId();
  const [allCommits, setAllCommits] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pulls = issue.links.filter((link) => link.kind === "pull_request");
  const branches = issue.links.filter((link) => link.kind === "branch");
  const commits = issue.links.filter((link) => link.kind === "commit");
  const hidden = commits.length - shownCommits;
  const manyRepos = new Set(issue.links.map((link) => link.repo)).size > 1;

  if (issue.links.length === 0) {
    return null;
  }

  if (collapsible && !expanded) {
    return (
      <section aria-labelledby={heading}>
        <h2 className="sr-only" id={heading}>
          Development
        </h2>
        <SummaryButton
          details={details}
          expanded={false}
          links={issue.links}
          onToggle={setExpanded}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby={heading} className="flex flex-col">
      {collapsible ? (
        <>
          <h2 className="sr-only" id={heading}>
            Development
          </h2>
          <SummaryButton
            details={details}
            expanded
            links={issue.links}
            onToggle={setExpanded}
          />
        </>
      ) : (
        <h2
          className="text-muted-foreground flex h-7 items-center font-medium"
          id={heading}
        >
          Development
        </h2>
      )}
      <div className="flex flex-col" id={details}>
        {pulls.length > 0 ? (
          <Group count={pulls.length} title="Pull requests">
            {pulls.map((link) => (
              <PullRequestRow key={link.id} link={link} />
            ))}
          </Group>
        ) : null}
        {branches.length > 0 ? (
          <Group count={branches.length} title="Branches">
            {branches.map((link) => (
              <LinkRow
                action={
                  link.state === "deleted" ||
                  pulls.some((pull) => pull.repo === link.repo) ? null : (
                    <>
                      <span aria-hidden>·</span>
                      <a
                        className="hover:text-foreground hit-area relative shrink-0 hover:underline"
                        href={newPullRequestUrl(link.repoUrl, link.externalId)}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Create pull request
                      </a>
                    </>
                  )
                }
                icon={<GitBranchIcon aria-hidden className="size-3.5" />}
                key={link.id}
                link={link}
                meta={
                  link.state === "deleted"
                    ? `${link.repo} · deleted`
                    : link.repo
                }
                muted={link.state === "deleted"}
              />
            ))}
          </Group>
        ) : null}
        {commits.length > 0 ? (
          <Group count={commits.length} title="Commits">
            {(allCommits ? commits : commits.slice(0, shownCommits)).map(
              (link) => (
                <LinkRow
                  icon={
                    <GitCommitHorizontalIcon aria-hidden className="size-3.5" />
                  }
                  key={link.id}
                  link={link}
                  meta={[
                    link.externalId.slice(0, 7),
                    manyRepos ? link.repo : null,
                    link.authorLogin,
                    formatRelative(link.occurredAt),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                />
              )
            )}
            {hidden > 0 ? (
              <li>
                <button
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm py-1 text-xs outline-none focus-visible:ring-2"
                  onClick={() => {
                    setAllCommits(!allCommits);
                  }}
                  type="button"
                >
                  {allCommits ? "Show fewer" : `Show ${hidden} more`}
                </button>
              </li>
            ) : null}
          </Group>
        ) : null}
      </div>
    </section>
  );
};
