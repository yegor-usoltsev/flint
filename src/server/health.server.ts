import { db } from "~/server/db.server";
import { log } from "~/server/log.server";
import { s3 } from "~/server/s3.server";

const probe = async (name: string, check: PromiseLike<unknown>) => {
  try {
    await check;

    return "ok" as const;
  } catch (error) {
    log.error({ err: error }, `${name} health check failed`);

    return "error" as const;
  }
};

export const checkHealth = async () => {
  const [database, storage] = await Promise.all([
    probe("db", db`select 1`),
    probe("s3", s3.list({ maxKeys: 1 })),
  ]);

  return { db: database, s3: storage };
};
