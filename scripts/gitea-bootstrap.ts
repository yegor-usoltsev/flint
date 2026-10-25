import { realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { GiteaEnvSchema, giteaClient, Required } from "./gitea-client";

const appName = "Flint";
const envPath = path.join(import.meta.dir, "../.env.local");

export const upsertEnv = (content: string, values: Record<string, string>) => {
  const pending = new Map(Object.entries(values));

  const lines = content
    .split("\n")
    .filter((line, index, all) => line !== "" || index < all.length - 1)
    .map((line) => {
      const key = line.slice(0, line.indexOf("="));
      const value = pending.get(key);

      if (value === undefined) {
        return line;
      }

      pending.delete(key);

      return `${key}=${value}`;
    });

  for (const [key, value] of pending) {
    lines.push(`${key}=${value}`);
  }

  return `${lines.join("\n")}\n`;
};

export const writeEnv = async (
  file: string,
  values: Record<string, string>
) => {
  const target = await realpath(file).catch(() => file);
  const current = Bun.file(target);
  const content = (await current.exists()) ? await current.text() : "";
  const temporary = `${target}.${process.pid}.tmp`;

  await rm(temporary, { force: true });
  await writeFile(temporary, upsertEnv(content, values), { mode: 0o600 });
  await rename(temporary, target);
};

const EnvSchema = v.object({
  ...GiteaEnvSchema.entries,
  APP_URL: v.pipe(Required, v.url()),
  GITEA_CLIENT_ID: v.optional(v.string()),
  GITEA_CLIENT_SECRET: v.optional(v.string()),
  GITEA_WEBHOOK_SECRET: Required,
  GITEA_STALE_WEBHOOK_URL: v.optional(v.pipe(Required, v.url())),
  GITEA_WEBHOOK_URL: v.optional(v.pipe(Required, v.url())),
});

const AppSchema = v.object({
  client_id: v.string(),
  client_secret: v.string(),
  id: v.number(),
  name: v.string(),
  redirect_uris: v.array(v.string()),
});

const HookSchema = v.object({
  config: v.object({ url: v.string() }),
  id: v.number(),
});

const webhookEvents = ["push", "create", "delete", "pull_request", "status"];

const bootstrap = async () => {
  const env = v.parse(EnvSchema, process.env);
  const redirectUri = new URL("/api/auth/callback", env.APP_URL).href;

  const api = giteaClient(env);

  const webhookUrl =
    env.GITEA_WEBHOOK_URL ?? new URL("/api/webhooks/gitea", env.APP_URL).href;

  const hooks = await api(v.array(HookSchema), "/admin/hooks?type=system");
  const hook = hooks.find((candidate) => candidate.config.url === webhookUrl);

  const hookOptions = {
    active: true,
    config: {
      content_type: "json",
      is_system_webhook: "true",
      secret: env.GITEA_WEBHOOK_SECRET,
      url: webhookUrl,
    },
    events: webhookEvents,
  };

  await (hook === undefined
    ? api(HookSchema, "/admin/hooks", {
        body: JSON.stringify({ ...hookOptions, type: "gitea" }),
        method: "POST",
      })
    : api(HookSchema, `/admin/hooks/${hook.id}`, {
        body: JSON.stringify(hookOptions),
        method: "PATCH",
      }));
  console.log(
    `${hook === undefined ? "Created" : "Updated"} the Gitea system webhook for ${webhookUrl}`
  );

  const stale = hooks.find(
    (candidate) => candidate.config.url === env.GITEA_STALE_WEBHOOK_URL
  );

  if (stale !== undefined) {
    await api(v.null(), `/admin/hooks/${stale.id}`, { method: "DELETE" });
    console.log(`Deleted the Gitea system webhook for ${stale.config.url}`);
  }

  const apps = await api(
    v.array(v.omit(AppSchema, ["client_secret"])),
    "/user/applications/oauth2"
  );

  const existing = apps.find((app) => app.name === appName);

  if (
    existing !== undefined &&
    existing.client_id === env.GITEA_CLIENT_ID &&
    env.GITEA_CLIENT_SECRET !== undefined &&
    existing.redirect_uris.join(",") === redirectUri
  ) {
    console.log(`Gitea OAuth app ${appName} is up to date`);

    return;
  }

  if (existing) {
    await api(v.null(), `/user/applications/oauth2/${existing.id}`, {
      method: "DELETE",
    });
  }

  const created = await api(AppSchema, "/user/applications/oauth2", {
    body: JSON.stringify({
      confidential_client: true,
      name: appName,
      redirect_uris: [redirectUri],
    }),
    method: "POST",
  });

  await writeEnv(envPath, {
    GITEA_CLIENT_ID: created.client_id,
    GITEA_CLIENT_SECRET: created.client_secret,
  });
  console.log(`Created Gitea OAuth app ${appName}; wrote ${envPath}`);
};

if (import.meta.main) {
  await bootstrap();
}
