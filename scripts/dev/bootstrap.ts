import { $ } from "bun";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { GiteaEnvSchema, giteaClient } from "../gitea-client";

const flags = new Set(process.argv.slice(2));
const appMode = flags.has("--app");
const storageOnly = flags.has("--storage-only");

if (
  [...flags].some((flag) => flag !== "--app" && flag !== "--storage-only") ||
  (appMode && storageOnly)
) {
  throw new Error("Usage: bun run bootstrap [--app | --storage-only]");
}

await $`docker compose up -d --wait postgres silo`;

await $`docker compose exec -T silo mc alias set local http://localhost:9000 flint flint-silo-secret`;

await $`docker compose exec -T silo mc mb --ignore-existing local/flint`;

if (!storageOnly) {
  await $`docker compose up -d --wait gitea host-relay runner`;

  const users =
    await $`docker compose exec -T gitea gitea admin user list`.text();

  const existingUsers = new Set(
    users.split("\n").map((line) => line.trim().split(/\s+/u)[1])
  );

  const createUser = async (username: string) => {
    if (existingUsers.has(username)) {
      return;
    }

    const admin = username === "alice" ? ["--admin"] : [];
    const email = `${username}@example.com`;

    await $`docker compose exec -T gitea gitea admin user create --username ${username} --password password --email ${email} --must-change-password=false ${admin}`;
  };

  await createUser("alice");
  await createUser("bob");
  await createUser("carol");

  const env = v.parse(GiteaEnvSchema, process.env);
  const api = giteaClient(env);

  const authorization =
    env.GITEA_ADMIN_TOKEN === undefined
      ? `Basic ${btoa([env.GITEA_ADMIN_USER ?? "", env.GITEA_ADMIN_PASSWORD ?? ""].join(":"))}`
      : `token ${env.GITEA_ADMIN_TOKEN}`;

  const organization = await fetch(
    new URL("/api/v1/orgs/acme", env.GITEA_URL),
    {
      headers: { Authorization: authorization },
    }
  );

  await organization.body?.cancel();

  if (organization.status === 404) {
    await api(v.unknown(), "/orgs", {
      body: JSON.stringify({ username: "acme" }),
      method: "POST",
    });
  } else if (!organization.ok) {
    throw new Error(`Gitea GET /orgs/acme: HTTP ${organization.status}`);
  }

  const webhook = new URL("/api/webhooks/gitea", process.env["APP_URL"]);
  webhook.protocol = "http:";
  webhook.port = "4700";
  webhook.hostname = appMode ? "app" : "host-relay";
  const staleWebhook = new URL(webhook);
  staleWebhook.hostname = appMode ? "host-relay" : "app";

  await $`bun run gitea:bootstrap`.env({
    ...process.env,
    GITEA_STALE_WEBHOOK_URL: staleWebhook.href,
    GITEA_WEBHOOK_URL: webhook.href,
  });

  if (appMode) {
    await $`docker compose --profile app up -d --wait --build app`;
  }
}
