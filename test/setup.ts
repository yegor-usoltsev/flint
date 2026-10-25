import { SQL } from "bun";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

const appUrl = new URL(
  process.env["DATABASE_URL"] ?? "postgres://flint:flint@localhost:4702/flint"
);

const checkout = Bun.hash(import.meta.dir)
  .toString(36)
  .slice(0, 8);

const url = new URL(process.env["TEST_DATABASE_URL"] ?? appUrl.href);

if (process.env["TEST_DATABASE_URL"] === undefined) {
  url.pathname = `/flint_test_${checkout}`;
}

const testDatabase = url.pathname.slice(1);

if (!/^[a-z0-9_]+$/u.test(testDatabase)) {
  throw new Error(`Unsupported test database name: ${testDatabase}`);
}

const maintenanceUrl = new URL(url);

maintenanceUrl.pathname = "/postgres";

const server = new SQL(maintenanceUrl.href);

const DuplicateDatabaseSchema = v.object({
  errno: v.picklist(["42P04", "23505"]),
});

try {
  await server.unsafe(`create database ${testDatabase}`);
} catch (error) {
  if (!v.is(DuplicateDatabaseSchema, error)) {
    throw error;
  }
}

await server.close();

const migrations = new Set(
  await Array.fromAsync(
    new Bun.Glob("*.sql").scan(`${import.meta.dir}/../migrations`)
  )
);

const test = new SQL(url.href);

const [stale] = await test<{ name: string }[]>`
  select name from schema_migrations
  where name <> all(${test.array([...migrations], "text")})
  limit 1
`.catch(() => []);

if (stale !== undefined) {
  await test.unsafe("drop schema public cascade; create schema public");
}

await test.close();

Object.assign(process.env, {
  APP_URL: "http://flint.test",
  DATABASE_URL: url.href,
  GITEA_CLIENT_ID: "test-client",
  GITEA_CLIENT_SECRET: "test-secret",
  GITEA_PUBLIC_URL: "http://gitea-public.test",
  GITEA_URL: "http://gitea.test",
  GITEA_WEBHOOK_SECRET: "test-webhook-secret",
  MAX_UPLOAD_BYTES: "1048576",
  S3_ACCESS_KEY_ID: process.env["S3_ACCESS_KEY_ID"] ?? "flint",
  S3_BUCKET: process.env["S3_BUCKET"] ?? "flint",
  S3_ENDPOINT: process.env["S3_ENDPOINT"] ?? "http://localhost:4703",
  S3_SECRET_ACCESS_KEY:
    process.env["S3_SECRET_ACCESS_KEY"] ?? "flint-silo-secret",
  TRASH_RETENTION_DAYS: "30",
});

const migration = Bun.spawnSync(["bun", "scripts/migrate.ts"], {
  env: process.env,
  stderr: "inherit",
  stdout: "ignore",
});

if (!migration.success) {
  throw new Error("Test database migration failed");
}

if (process.env["LIVE_EMBEDDINGS"] !== "1") {
  Object.assign(process.env, {
    EMBEDDING_API_KEY: "",
    EMBEDDING_API_URL: "https://embeddings.test/api/v1",
  });
}
