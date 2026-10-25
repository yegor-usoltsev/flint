// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { db } from "~/server/db.server";
import { env } from "~/server/env.server";
import { log } from "~/server/log.server";

const dimensions = 1024;
const maxChars = 8000;
const retryDelaysMs = [500, 2000, 8000];
const requestTimeoutMs = 30_000;

export const embeddingsEnabled = () => env.EMBEDDING_API_KEY !== "";

const EmbeddingsSchema = v.object({
  data: v.array(
    v.object({
      embedding: v.array(v.number()),
      index: v.number(),
    })
  ),
});

const embeddingsUrl = () => {
  let base = env.EMBEDDING_API_URL;

  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  return `${base}/embeddings`;
};

const requestEmbeddings = async (texts: string[], timeoutMs: number) => {
  const response = await fetch(embeddingsUrl(), {
    body: JSON.stringify({
      dimensions,
      input: texts.map((text) => text.slice(0, maxChars)),
      model: env.EMBEDDING_MODEL,
    }),
    headers: {
      authorization: `Bearer ${env.EMBEDDING_API_KEY}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Embeddings request failed with ${response.status}`);
  }

  const { data } = v.parse(EmbeddingsSchema, await response.json());
  const wrong = data.find(({ embedding }) => embedding.length !== dimensions);

  if (wrong !== undefined) {
    throw new Error(
      `Embedding model ${env.EMBEDDING_MODEL} returned ${wrong.embedding.length} dimensions; Flint needs ${dimensions}`
    );
  }

  return data
    .toSorted((a, b) => a.index - b.index)
    .map(({ embedding }) => embedding);
};

export const embed = async (
  texts: string[],
  delays = retryDelaysMs,
  timeoutMs = requestTimeoutMs
): Promise<number[][]> => {
  try {
    return await requestEmbeddings(texts, timeoutMs);
  } catch (error) {
    const [delay, ...rest] = delays;

    if (delay === undefined) {
      throw error;
    }

    await Bun.sleep(delay);

    return await embed(texts, rest, timeoutMs);
  }
};

export const toVector = (embedding: number[]) => `[${embedding.join(",")}]`;

const hashOf = (text: string) =>
  new Bun.CryptoHasher("sha256")
    .update(`${env.EMBEDDING_MODEL}\n${text}`)
    .digest("hex");

export type EmbeddedKind = "issue" | "wiki";

interface Source {
  hash: string | null;
  id: string;
  text: string;
}

const sources = {
  issue: db`
    select id, title || E'\\n\\n' || description_md as text,
      embedding_hash as hash
    from issues where deleted_at is null
  `,
  wiki: db`
    select id, title || E'\\n\\n' || body_md as text, embedding_hash as hash
    from wiki_pages where deleted_at is null
  `,
};

const store = async (kind: EmbeddedKind, rows: Source[]) => {
  const vectors = await embed(rows.map(({ text }) => text));

  await Promise.all(
    rows.map(async (row, index) => {
      const vector = toVector(vectors[index] ?? []);
      const hash = hashOf(row.text);

      await (kind === "issue"
        ? db`
            update issues set embedding = ${vector}::vector,
              embedding_model = ${env.EMBEDDING_MODEL}, embedding_hash = ${hash}
            where id = ${row.id}
              and title || E'\\n\\n' || description_md = ${row.text}
          `
        : db`
            update wiki_pages set embedding = ${vector}::vector,
              embedding_model = ${env.EMBEDDING_MODEL}, embedding_hash = ${hash}
            where id = ${row.id} and title || E'\\n\\n' || body_md = ${row.text}
          `);
    })
  );
};

const stale = (rows: Source[]) =>
  rows.filter((row) => row.hash !== hashOf(row.text));

const inflight = new Set<Promise<void>>();

const refresh = async (kind: EmbeddedKind, id: string) => {
  try {
    const rows = await db<Source[]>`${sources[kind]} and id = ${id}`;
    const changed = stale(rows);

    if (changed.length > 0) {
      await store(kind, changed);
    }
  } catch (error) {
    log.warn({ err: error, id, kind }, "Embedding refresh failed");
  }
};

export const refreshEmbedding = async (kind: EmbeddedKind, id: string) => {
  if (!embeddingsEnabled()) {
    return;
  }

  const work = refresh(kind, id);

  inflight.add(work);
  await work;
  inflight.delete(work);
};

export const settleEmbeddings = async () => {
  await Promise.all(inflight);
};

export const backfillEmbeddings = async (batchSize = 32) => {
  let count = 0;

  for (const kind of ["issue", "wiki"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Kinds run one after another to keep batches small.
    const changed = stale(await db<Source[]>`${sources[kind]}`);

    for (let start = 0; start < changed.length; start += batchSize) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Batches run in sequence to respect the provider's rate limits.
      await store(kind, changed.slice(start, start + batchSize));
    }

    count += changed.length;
  }

  return count;
};
