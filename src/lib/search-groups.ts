import type { IssueHit, WikiPageHit } from "~/lib/api-types";

export const groupLimit = 5;

export type GroupKind = "issues" | "pages";

interface Scored {
  id: string;
  score: number;
}

export type ResultGroup<
  Issue extends Scored = IssueHit,
  Page extends Scored = WikiPageHit,
> =
  | { extra: number; hits: Issue[]; kind: "issues"; open: boolean }
  | { extra: number; hits: Page[]; kind: "pages"; open: boolean };

// Each kind shows its best few hits, and the kind whose best hit scores higher comes first, so a matching page never waits behind every loosely related issue.
export const resultGroups = <Issue extends Scored, Page extends Scored>(
  issues: Issue[],
  pages: Page[],
  expanded: GroupKind[]
): ResultGroup<Issue, Page>[] => {
  const group = <Hit extends Scored>(hits: Hit[], kind: GroupKind) => {
    const open = expanded.includes(kind);

    return {
      extra: Math.max(0, hits.length - groupLimit),
      hits: open ? hits : hits.slice(0, groupLimit),
      open,
    };
  };

  const groups: ResultGroup<Issue, Page>[] = [
    { ...group(issues, "issues"), kind: "issues" },
    { ...group(pages, "pages"), kind: "pages" },
  ];

  return groups
    .filter(({ hits }) => hits.length > 0)
    .toSorted((a, b) => (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0));
};
