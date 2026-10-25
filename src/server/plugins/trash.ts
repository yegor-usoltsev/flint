import { definePlugin } from "nitro";

import { env } from "~/server/env.server";
import { log } from "~/server/log.server";
import { purgeTrash } from "~/server/trash.server";

export default definePlugin(() => {
  Bun.cron(env.TRASH_PURGE_CRON, async () => {
    try {
      await purgeTrash();
    } catch (error) {
      log.error({ err: error }, "Trash purge failed");
    }
  }).unref();
});
