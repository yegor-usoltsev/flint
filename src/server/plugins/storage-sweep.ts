import { definePlugin } from "nitro";

import { env } from "~/server/env.server";
import { log } from "~/server/log.server";
import { sweepStorage } from "~/server/storage-sweep.server";

export default definePlugin(() => {
  Bun.cron(env.STORAGE_SWEEP_CRON, async () => {
    try {
      await sweepStorage();
    } catch (error) {
      log.error({ err: error }, "Storage sweep failed");
    }
  }).unref();
});
