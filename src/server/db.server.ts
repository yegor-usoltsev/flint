import { SQL } from "bun";

import { env } from "~/server/env.server";

export const db = new SQL(env.DATABASE_URL);
