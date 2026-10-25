import { version } from "../../package.json";

export const build = { commit: process.env.FLINT_COMMIT ?? "dev", version };
