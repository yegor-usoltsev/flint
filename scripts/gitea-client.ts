// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

export const Required = v.pipe(v.string(), v.nonEmpty());

export const GiteaEnvSchema = v.object({
  GITEA_ADMIN_PASSWORD: v.optional(Required),
  GITEA_ADMIN_TOKEN: v.optional(Required),
  GITEA_ADMIN_USER: v.optional(Required),
  GITEA_URL: v.pipe(Required, v.url()),
});

export const giteaClient = (env: v.InferOutput<typeof GiteaEnvSchema>) => {
  const basic = btoa(
    [env.GITEA_ADMIN_USER ?? "", env.GITEA_ADMIN_PASSWORD ?? ""].join(":")
  );

  const authorization =
    env.GITEA_ADMIN_TOKEN === undefined
      ? `Basic ${basic}`
      : `token ${env.GITEA_ADMIN_TOKEN}`;

  return async <Schema extends v.GenericSchema>(
    schema: Schema,
    endpoint: string,
    init: RequestInit = {}
  ) => {
    const response = await fetch(new URL(`/api/v1${endpoint}`, env.GITEA_URL), {
      ...init,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Gitea ${init.method ?? "GET"} ${endpoint}: ${response.status} ${await response.text()}`
      );
    }

    return v.parse(
      schema,
      response.status === 204 ? null : await response.json()
    );
  };
};
