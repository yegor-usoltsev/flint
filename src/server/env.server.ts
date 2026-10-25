// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

const Required = v.pipe(v.string(), v.trim(), v.nonEmpty());
const Url = v.pipe(Required, v.url());

const isCron = (value: string) => {
  try {
    Bun.cron.parse(value);

    return true;
  } catch {
    return false;
  }
};

const Cron = v.pipe(
  Required,
  v.check(isCron, (issue) => `Invalid cron expression: ${issue.received}`)
);

const EnvSchema = v.object({
  APP_URL: Url,
  DATABASE_URL: Required,
  GITEA_CLIENT_ID: Required,
  GITEA_CLIENT_SECRET: Required,
  GITEA_PUBLIC_URL: Url,
  GITEA_URL: Url,
  GITEA_WEBHOOK_SECRET: Required,
  EMBEDDING_API_KEY: v.optional(v.pipe(v.string(), v.trim()), ""),
  EMBEDDING_API_URL: v.optional(Url, "https://openrouter.ai/api/v1"),
  EMBEDDING_MODEL: v.optional(Required, "perplexity/pplx-embed-v1-0.6b"),
  MAX_UPLOAD_BYTES: v.optional(
    v.pipe(
      v.string(),
      v.digits(),
      v.transform(Number),
      v.minValue(1_048_576, "MAX_UPLOAD_BYTES must be at least 1048576 (1 MB)")
    ),
    "26214400"
  ),
  S3_ACCESS_KEY_ID: Required,
  S3_BUCKET: Required,
  S3_ENDPOINT: Url,
  S3_REGION: v.optional(Required, "auto"),
  S3_SECRET_ACCESS_KEY: Required,
  STORAGE_SWEEP_CRON: v.optional(Cron, "1 0 * * 0"),
  TRASH_PURGE_CRON: v.optional(Cron, "0 0 * * *"),
  TRASH_RETENTION_DAYS: v.optional(
    v.pipe(v.string(), v.digits(), v.transform(Number), v.minValue(1)),
    "30"
  ),
});

export const env = v.parse(EnvSchema, process.env);
