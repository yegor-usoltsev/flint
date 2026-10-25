// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import type { IssueSummary, WikiPageHit } from "~/lib/api-types";
import { requireWorkspace } from "~/server/access.server";
import type { Actor } from "~/server/api.server";
import { db } from "~/server/db.server";
import { embed, embeddingsEnabled, toVector } from "~/server/embeddings.server";
import { env } from "~/server/env.server";
import { escapeLike, keyPattern, summaryColumns } from "~/server/issues.server";
import { log } from "~/server/log.server";

export const SearchQuerySchema = v.object({
  limit: v.optional(
    v.pipe(
      v.string(),
      v.digits(),
      v.transform(Number),
      v.minValue(1),
      v.maxValue(50)
    ),
    "20"
  ),
  mode: v.optional(v.picklist(["fts", "hybrid"]), "hybrid"),
  q: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(200)),
  type: v.optional(v.picklist(["all", "issues", "wiki"]), "all"),
});

const pageHitColumns = db`
  w.id, w.path, w.title, w.updated_at as "updatedAt"
`;

export const readSearchQuery = (request: Request) => {
  const params = new URL(request.url).searchParams;

  return v.parse(SearchQuerySchema, {
    limit: params.get("limit") ?? undefined,
    mode: params.get("mode") ?? undefined,
    q: params.get("q") ?? "",
    type: params.get("type") ?? undefined,
  });
};

const candidates = 50;
const rrfK = 60;
const maxDistance = 0.85;
const distanceWindow = 0.08;
const queryTimeoutMs = 1500;
const minSemanticLength = 3;

interface TextRank {
  exact: boolean;
  textRank: number;
  titleMatch: boolean;
}

type IssueRow = IssueSummary & Partial<TextRank> & { distance?: number };

type PageSummary = Omit<WikiPageHit, "score">;

type PageRow = PageSummary & Partial<TextRank> & { distance?: number };

// Text matches of both kinds share one order, from an exact key down to the full-text rank, so scores compare across issues and pages.
const byText = (a: TextRank, b: TextRank) =>
  Number(b.exact) - Number(a.exact) ||
  Number(b.titleMatch) - Number(a.titleMatch) ||
  b.textRank - a.textRank;

const fuse = (ranked: { id: string }[][]) => {
  const scores = new Map<string, number>();

  for (const list of ranked) {
    for (const [rank, { id }] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + rank + 1));
    }
  }

  return scores;
};

const best = <Hit extends { id: string }>(
  rows: Hit[],
  scores: Map<string, number>,
  limit: number
) =>
  [...new Map(rows.map((row) => [row.id, row])).values()]
    .flatMap((row) => {
      const score = scores.get(row.id);

      return score === undefined ? [] : [{ row, score }];
    })
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);

const issueHit = ({
  distance: _distance,
  exact: _exact,
  textRank: _textRank,
  titleMatch: _titleMatch,
  ...issue
}: IssueRow) => issue;

const pageHit = ({
  distance: _distance,
  exact: _exact,
  textRank: _textRank,
  titleMatch: _titleMatch,
  ...page
}: PageRow) => page;

const embedQuery = async (q: string) => {
  try {
    const [embedding] = await embed([q], [], queryTimeoutMs);

    return embedding === undefined ? null : toVector(embedding);
  } catch (error) {
    log.warn(
      { err: error },
      "Query embedding failed; searching full-text only"
    );

    return null;
  }
};

const nearest = <Item extends { distance: number }>(rows: Item[]) => {
  const cutoff = Math.min(
    maxDistance,
    (rows[0]?.distance ?? 0) + distanceWindow
  );

  return rows.filter(({ distance }) => distance <= cutoff);
};

export const search = async (
  actor: Actor,
  slug: string,
  { limit, mode, q, type }: v.InferOutput<typeof SearchQuerySchema>
) => {
  const workspace = await requireWorkspace(actor, slug);
  const pattern = `%${escapeLike(q)}%`;

  // An issue key or a query of one or two characters means nothing to the model and lands nearer unrelated rows than real matches do.
  const semantic =
    mode === "hybrid" &&
    embeddingsEnabled() &&
    q.length >= minSemanticLength &&
    !keyPattern.test(q);

  const depth = semantic ? candidates : limit;

  const [ftsIssues, ftsPages, vector] = await Promise.all([
    type === "wiki"
      ? []
      : db<(IssueSummary & TextRank)[]>`
          select ${summaryColumns},
            lower(p.key || '-' || i.number) = lower(${q}) as exact,
            i.title ilike ${pattern} as "titleMatch",
            ts_rank(i.search, websearch_to_tsquery('english', ${q})) as "textRank"
          from issues i join projects p on p.id = i.project_id
          where p.workspace_id = ${workspace.id} and i.deleted_at is null
            and (
              lower(p.key || '-' || i.number) = lower(${q})
              or i.title ilike ${pattern}
              or i.search @@ websearch_to_tsquery('english', ${q})
            )
          order by
            lower(p.key || '-' || i.number) = lower(${q}) desc,
            i.title ilike ${pattern} desc,
            ts_rank(i.search, websearch_to_tsquery('english', ${q})) desc,
            i.updated_at desc
          limit ${depth}
        `,
    type === "issues"
      ? []
      : db<(PageSummary & TextRank)[]>`
          select ${pageHitColumns}, false as exact,
            w.title ilike ${pattern} as "titleMatch",
            ts_rank(w.search, websearch_to_tsquery('english', ${q})) as "textRank"
          from wiki_pages w
          where w.workspace_id = ${workspace.id} and w.kind = 'page'
            and w.deleted_at is null
            and (
              w.title ilike ${pattern}
              or w.path ilike ${pattern}
              or w.search @@ websearch_to_tsquery('english', ${q})
            )
          order by
            w.title ilike ${pattern} desc,
            ts_rank(w.search, websearch_to_tsquery('english', ${q})) desc,
            w.updated_at desc
          limit ${depth}
        `,
    semantic ? embedQuery(q) : null,
  ]);

  const exactKey = ftsIssues.filter(({ exact }) => exact);
  const text = [...ftsIssues, ...ftsPages].toSorted(byText);

  const results = (
    scores: Map<string, number>,
    issues: IssueRow[],
    pages: PageRow[]
  ) => ({
    issues: best(issues, scores, limit).map(({ row, score }) => ({
      ...issueHit(row),
      score,
    })),
    pages: best(pages, scores, limit).map(({ row, score }) => ({
      ...pageHit(row),
      score,
    })),
    semantic: vector !== null,
  });

  if (vector === null) {
    return results(fuse([exactKey, text]), ftsIssues, ftsPages);
  }

  const [vectorIssues, vectorPages] = await Promise.all([
    type === "wiki"
      ? []
      : db<(IssueSummary & { distance: number })[]>`
          select ${summaryColumns}, i.embedding <=> ${vector}::vector as distance
          from issues i join projects p on p.id = i.project_id
          where p.workspace_id = ${workspace.id} and i.deleted_at is null
            and i.embedding_model = ${env.EMBEDDING_MODEL}
          order by i.embedding <=> ${vector}::vector
          limit ${candidates}
        `,
    type === "issues"
      ? []
      : db<(PageSummary & { distance: number })[]>`
          select ${pageHitColumns}, w.embedding <=> ${vector}::vector as distance
          from wiki_pages w
          where w.workspace_id = ${workspace.id} and w.kind = 'page'
            and w.deleted_at is null
            and w.embedding_model = ${env.EMBEDDING_MODEL}
          order by w.embedding <=> ${vector}::vector
          limit ${candidates}
        `,
  ]);

  const lexical = new Set(text.map(({ id }) => id));
  // A single word sits as close to unrelated rows as to related ones, so text matches win when there are any.
  const lexicalOnly = !/\s/u.test(q) && lexical.size > 0;

  const meaning = [...nearest(vectorIssues), ...nearest(vectorPages)]
    .filter(({ id }) => !lexicalOnly || lexical.has(id))
    .toSorted((a, b) => a.distance - b.distance);

  return results(
    fuse([exactKey, text, meaning]),
    [...ftsIssues, ...vectorIssues],
    [...ftsPages, ...vectorPages]
  );
};
