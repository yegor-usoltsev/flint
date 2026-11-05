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

const cacheMs = 2000;

const probeAll = async () => {
  const [database, storage] = await Promise.all([
    probe("db", db`select 1`),
    probe("s3", s3.list({ maxKeys: 1 })),
  ]);

  return { db: database, s3: storage };
};

let latest: { at: number; health: ReturnType<typeof probeAll> } | undefined;

export const checkHealth = async () => {
  if (latest === undefined || Date.now() - latest.at >= cacheMs) {
    latest = { at: Date.now(), health: probeAll() };
  }

  return await latest.health;
};
