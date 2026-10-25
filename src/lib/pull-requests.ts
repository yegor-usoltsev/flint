import {
  CircleCheckIcon,
  CircleDotDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CommitStatusState, PullRequestState } from "~/lib/api-types";
import type { Color } from "~/lib/colors";

export const pullRequestStyles = {
  closed: { color: "red", icon: GitPullRequestClosedIcon, label: "Closed" },
  draft: { color: "gray", icon: GitPullRequestDraftIcon, label: "Draft" },
  merged: { color: "purple", icon: GitMergeIcon, label: "Merged" },
  open: { color: "green", icon: GitPullRequestIcon, label: "Open" },
} satisfies Record<
  PullRequestState,
  { color: Color; icon: LucideIcon; label: string }
>;

export const pullRequestLabel = (state: PullRequestState) =>
  pullRequestStyles[state].label;

export const ciStyles = {
  error: {
    color: "red",
    icon: CircleXIcon,
    label: "Errored",
    summary: "Checks errored",
  },
  failure: {
    color: "red",
    icon: CircleXIcon,
    label: "Failed",
    summary: "Checks failed",
  },
  pending: {
    color: "amber",
    icon: CircleDotDashedIcon,
    label: "Running",
    summary: "Checks running",
  },
  skipped: {
    color: "gray",
    icon: CircleMinusIcon,
    label: "Skipped",
    summary: "Checks skipped",
  },
  success: {
    color: "green",
    icon: CircleCheckIcon,
    label: "Passed",
    summary: "Checks passed",
  },
  warning: {
    color: "orange",
    icon: TriangleAlertIcon,
    label: "Warning",
    summary: "Checks passed with warnings",
  },
} satisfies Record<
  CommitStatusState,
  { color: Color; icon: LucideIcon; label: string; summary: string }
>;

const severity: CommitStatusState[] = [
  "error",
  "failure",
  "warning",
  "pending",
  "skipped",
  "success",
];

export const checksSummary = (checks: { state: CommitStatusState }[]) => {
  const counts = severity.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;

    return count === 0
      ? []
      : [`${count} ${ciStyles[state].label.toLowerCase()}`];
  });

  return `${checks.length} ${checks.length === 1 ? "check" : "checks"} · ${counts.join(", ")}`;
};

export const settledChecks = (checks: { state: CommitStatusState }[]) =>
  checks.every(({ state }) => state === "success" || state === "skipped");

export const isWebUrl = (url: string) => /^https?:\/\//iu.test(url);

export const newPullRequestUrl = (repoUrl: string, branch: string) =>
  `${repoUrl}/pulls/new/${branch.split("/").map(encodeURIComponent).join("/")}`;
