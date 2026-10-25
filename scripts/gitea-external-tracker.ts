// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { GiteaEnvSchema, giteaClient, Required } from "./gitea-client";

const EnvSchema = v.object({
  ...GiteaEnvSchema.entries,
  APP_URL: v.pipe(Required, v.url()),
});

const TrackerSchema = v.object({
  external_tracker_format: v.string(),
  external_tracker_regexp_pattern: v.optional(v.string(), ""),
  external_tracker_style: v.string(),
  external_tracker_url: v.string(),
});

const RepoSchema = v.object({
  external_tracker: v.nullish(TrackerSchema, null),
  full_name: v.string(),
  has_issues: v.boolean(),
});

const pageSize = 50;

export const externalTracker = (appUrl: string) => ({
  external_tracker_format: `${new URL(appUrl).origin}/issue/{index}`,
  external_tracker_regexp_pattern: String.raw`\[([A-Za-z][A-Za-z0-9]{1,4}-[0-9]+)\]`,
  external_tracker_style: "regexp",
  external_tracker_url: `${new URL(appUrl).origin}/`,
});

export const setExternalTracker = async (
  api: ReturnType<typeof giteaClient>,
  appUrl: string,
  name: string
) => {
  const tracker = externalTracker(appUrl);
  const repo = await api(RepoSchema, `/repos/${name}`);

  if (repo.has_issues && Bun.deepEquals(repo.external_tracker, tracker)) {
    console.log(`${name}: up to date`);

    return;
  }

  await api(RepoSchema, `/repos/${name}`, {
    body: JSON.stringify({ external_tracker: tracker, has_issues: true }),
    method: "PATCH",
  });
  console.log(
    `${name}: external tracker set to ${tracker.external_tracker_format}`
  );
};

const configure = async (targets: string[]) => {
  if (targets.length === 0) {
    throw new Error(
      "Usage: bun run gitea:external-tracker <owner>|<owner/repo>..."
    );
  }

  const env = v.parse(EnvSchema, process.env);
  const api = giteaClient(env);

  const ownerRepos = async (owner: string, page = 1): Promise<string[]> => {
    const repos = await api(
      v.array(RepoSchema),
      `/users/${encodeURIComponent(owner)}/repos?limit=${pageSize}&page=${page}`
    );

    const names = repos.map((repo) => repo.full_name);

    if (repos.length < pageSize) {
      return names;
    }

    const rest = await ownerRepos(owner, page + 1);

    return [...names, ...rest];
  };

  const lists = await Promise.all(
    targets.map(async (target) =>
      target.includes("/") ? [target] : await ownerRepos(target)
    )
  );

  await Promise.all(
    [...new Set(lists.flat())].map(async (name) => {
      await setExternalTracker(api, env.APP_URL, name);
    })
  );
};

if (import.meta.main) {
  await configure(process.argv.slice(2));
}
