import { db } from "~/server/db.server";
import {
  backfillEmbeddings,
  embeddingsEnabled,
} from "~/server/embeddings.server";
import { env } from "~/server/env.server";

if (!embeddingsEnabled()) {
  throw new Error("Set EMBEDDING_API_KEY to compute embeddings");
}

const count = await backfillEmbeddings();

console.info(
  `Embedded ${count} issues and wiki pages with ${env.EMBEDDING_MODEL}`
);

await db.close();
