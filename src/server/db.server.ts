import { SQL } from "bun";

import { env } from "~/server/env.server";

export const db = new SQL(env.DATABASE_URL, {
  connection: {
    idle_in_transaction_session_timeout: "10s",
    lock_timeout: "5s",
  },
});
