import { openAsBlob } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { text as readStream } from "node:stream/consumers";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { endpointPath } from "../src/lib/endpoints.ts";
import type {
  Body,
  Endpoint,
  RequestOptions,
  ResponseOf,
} from "../src/lib/endpoints.ts";

export type Json =
  | boolean
  | number
  | string
  | null
  | Json[]
  | { [key: string]: Json | undefined };

export interface Output {
  raw?: string;
  result: unknown;
  text?: () => Promise<string> | string;
}

export const wantsJson = (argv = process.argv) =>
  argv.includes("--json") ||
  (!argv.includes("--human") && !process.stdout.isTTY);

export const print = async ({ raw, result, text }: Output) => {
  if (raw !== undefined) {
    console.log(raw);
  } else if (wantsJson()) {
    console.log(JSON.stringify(result));
  } else {
    console.log(
      text === undefined ? JSON.stringify(result, null, 2) : await text()
    );
  }
};

export const action =
  <Args extends unknown[]>(handler: (...args: Args) => Promise<Output>) =>
  async (...args: Args) => {
    await print(await handler(...args));
  };

export class CliError extends Error {
  readonly body: unknown;
  readonly exitCode: number;

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The body is only printed with JSON.stringify.
  constructor(message: string, exitCode: number, body?: unknown) {
    super(message);
    this.name = "CliError";
    this.body = body ?? { error: { code: "cli_error", message } };
    this.exitCode = exitCode;
  }
}

export const usageError = (message: string) =>
  new CliError(message, 2, { error: { code: "usage", message } });

export const integer = (value: string, flag = "value") => {
  if (!/^\d+$/u.test(value)) {
    throw usageError(`${flag} needs a number, got “${value}”`);
  }

  return Number(value);
};

export const collect = (value: string, previous: string[] = []) => [
  ...previous,
  value,
];

export const table = (rows: string[][]) => {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0))
  );

  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths?.[column] ?? 0)
        )
        .join("  ")
        .trimEnd()
    )
    .join("\n");
};

export const localTime = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
  });

const missing = (error: Error) => "code" in error && error.code === "ENOENT";

const readJson = async <Schema extends v.GenericSchema>(
  file: string,
  schema: Schema
) => {
  try {
    return v.parse(schema, JSON.parse(await readFile(file, "utf-8")));
  } catch (error) {
    if (error instanceof Error && missing(error)) {
      return null;
    }

    throw error;
  }
};

export const configPath = () =>
  process.env["FLINT_CONFIG"] ??
  path.join(
    process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
    "flint",
    "config.json"
  );

const ConfigSchema = v.object({ token: v.string(), url: v.string() });

export type Config = v.InferOutput<typeof ConfigSchema>;

export const readConfig = async (): Promise<Config> => {
  const saved = (await readJson(configPath(), v.partial(ConfigSchema))) ?? {};

  const token = process.env["FLINT_TOKEN"] ?? saved.token;
  const url = process.env["FLINT_URL"] ?? saved.url;

  if (token === undefined || url === undefined) {
    throw new CliError(
      "Not logged in: run flint login --url <url> --token <token>",
      1,
      {
        error: {
          code: "not_logged_in",
          message: "Run flint login --url <url> --token <token>",
        },
      }
    );
  }

  return { token, url };
};

export const writeConfig = async (config: Config, file = configPath()) => {
  const temporary = `${file}.${process.pid}.tmp`;

  await mkdir(path.dirname(file), { recursive: true });
  await rm(temporary, { force: true });
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
};

export const removeConfig = async () => {
  await rm(configPath(), { force: true });
};

// oxlint-disable-next-line typescript/no-unsafe-return -- JSON.parse yields JSON values by definition.
export const parseJson = (source: string): Json => JSON.parse(source);

const ErrorSchema = v.object({
  error: v.object({ code: v.string(), message: v.string() }),
});

const httpError = (status: number, json: Json) => {
  const failure = v.safeParse(ErrorSchema, json);

  return new CliError(
    failure.success ? failure.output.error.message : `HTTP ${status}`,
    1,
    failure.success
      ? json
      : { error: { code: "http_error", message: `HTTP ${status}` } }
  );
};

const parseJsonOrNull = (source: string) => {
  try {
    return parseJson(source);
  } catch {
    return null;
  }
};

const apiUrl = (config: Config, apiPath: string) =>
  new URL(`/api/v1${apiPath.replace(/^\/?(?:api\/v1\/?)?/u, "/")}`, config.url);

const send = async (config: Config, apiPath: string, init: RequestInit) => {
  const headers = new Headers(init.headers);

  headers.set("authorization", `Bearer ${config.token}`);

  const response = await fetch(apiUrl(config, apiPath), { ...init, headers });
  const body = await response.text();
  let json: Json = null;

  try {
    json = body === "" ? null : parseJson(body);
  } catch {
    throw new CliError(`HTTP ${response.status}: not a JSON response`, 1);
  }

  if (!response.ok) {
    throw httpError(response.status, json);
  }

  return json;
};

export const download = async (config: Config, id: string) => {
  const response = await fetch(
    new URL(`/files/${encodeURIComponent(id)}`, config.url),
    { headers: { authorization: `Bearer ${config.token}` } }
  );

  if (!response.ok || response.body === null) {
    const body = await response.text();

    throw httpError(response.status, parseJsonOrNull(body));
  }

  const encoded = /filename\*=UTF-8''(?<name>[^;]+)/u.exec(
    response.headers.get("content-disposition") ?? ""
  )?.groups?.["name"];

  return {
    body: response.body,
    filename: encoded === undefined ? id : decodeURIComponent(encoded),
  };
};

export const request = async (
  config: Config,
  method: string,
  apiPath: string,
  body?: Json
) =>
  await send(config, apiPath, {
    body: body === undefined ? null : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: method.toUpperCase(),
  });

export const call = async <E extends Endpoint>(
  config: Config,
  endpoint: E,
  ...[options]: object extends RequestOptions<E>
    ? [RequestOptions<E>?]
    : [RequestOptions<E>]
) => {
  const { method, path: apiPath } = endpointPath(
    endpoint,
    options?.params,
    options?.query
  );

  const body = options?.body;

  // SAFETY: the endpoint map types every body but FormData as JSON.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See the SAFETY note.
  const json = body as Json | undefined;

  const answer: unknown =
    body instanceof FormData
      ? await send(config, apiPath, { body, method })
      : await request(config, method, apiPath, json);

  // SAFETY: the server answers each endpoint with its mapped response type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- See the SAFETY note.
  return answer as ResponseOf<E>;
};

export const changes = <E extends Endpoint>(_endpoint: E, body: Body<E>) => {
  if (Object.values(body ?? {}).every((value) => value === undefined)) {
    throw usageError("Pass something to change");
  }

  return body;
};

const openFile = async (file: string) => {
  const info = await stat(file);

  if (!info.isFile()) {
    throw new CliError(`Not a file: ${file}`, 1);
  }

  return await openAsBlob(file);
};

export const fileForm = async (file: string) => {
  const form = new FormData();

  try {
    form.set("file", await openFile(file), path.basename(file));
  } catch (error) {
    if (error instanceof CliError || !(error instanceof Error)) {
      throw error;
    }

    throw new CliError(
      missing(error)
        ? `No such file ${file}`
        : `Cannot read ${file}: ${error.message}`,
      1
    );
  }

  return form;
};

const EnvelopeSchema = v.fallback(v.looseObject({}), {});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- It takes what a catch clause caught, which may be a network TypeError.
export const withAttachments = (error: unknown, attachments: unknown[]) => {
  const message = error instanceof Error ? error.message : String(error);
  const failure = error instanceof CliError ? error : new CliError(message, 1);

  return new CliError(failure.message, failure.exitCode, {
    ...v.parse(EnvelopeSchema, failure.body),
    attachments,
  });
};

export const uploadAll = async <Uploaded>(
  files: string[],
  upload: (form: FormData) => Promise<Uploaded>
) => {
  const forms = await Promise.all(files.map(fileForm));
  const attachments: Uploaded[] = [];

  for (const form of forms) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Uploads run one at a time to keep memory and errors simple.
      attachments.push(await upload(form));
    } catch (error) {
      throw withAttachments(error, attachments);
    }
  }

  return attachments;
};

export const readText = async (file: string) =>
  file === "-"
    ? await readStream(process.stdin)
    : await readFile(file, "utf-8");

export const textOf = async (
  options: { description?: string; file?: string },
  words: string[] = []
) => {
  const argument = words.length > 0 ? words.join(" ") : undefined;

  const given = [options.description, options.file, argument].filter(
    (source) => source !== undefined
  );

  if (given.length > 1) {
    throw usageError("Pass the text once: as arguments, -d or -F");
  }

  if (options.file !== undefined) {
    return await readText(options.file);
  }

  return options.description ?? argument;
};

export const yesFlags = ["-y, --yes", "do not ask for confirmation"] as const;

export const confirm = async (question: string, yes = false) => {
  if (yes) {
    return;
  }

  if (!process.stdin.isTTY) {
    throw usageError(`${question} Pass --yes to confirm`);
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const answer = await terminal.question(`${question} [y/N] `);

  terminal.close();

  if (answer.trim().toLowerCase() !== "y") {
    throw new CliError("Canceled", 1, {
      error: { code: "canceled", message: "Canceled" },
    });
  }
};

export const mapLimit = async <Item, Result>(
  items: Item[],
  run: (item: Item) => Promise<Result>,
  limit = 4
) => {
  const results: PromiseSettledResult<Awaited<Result>>[] = [];
  const queue = items.entries();

  const worker = async () => {
    for (const [index, item] of queue) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Workers share one queue and take its items one at a time.
      [results[index]] = await Promise.allSettled([run(item)]);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));

  return results;
};

const LinkSchema = v.object({
  project: v.optional(v.string()),
  workspace: v.optional(v.string()),
});

export const linkFile = ".flint.json";

const findLink = async (
  directory = process.cwd()
): Promise<v.InferOutput<typeof LinkSchema>> => {
  const link = await readJson(path.join(directory, linkFile), LinkSchema);

  if (link !== null) {
    return link;
  }

  const parent = path.dirname(directory);

  return parent === directory ? {} : await findLink(parent);
};

export interface Scope {
  project?: string;
  workspace?: string;
}

export const projectOf = async (scope: Scope) => {
  if (scope.project !== undefined || scope.workspace !== undefined) {
    return scope.project;
  }

  const link = await findLink();

  return link.project ?? process.env["FLINT_PROJECT"];
};

export const workspaceOfProject = async (config: Config, key: string) => {
  const project = await call(config, "GET /projects/:key", { params: { key } });

  return project.workspaceSlug;
};

export const workspaceOf = async (config: Config, scope: Scope) => {
  if (scope.project !== undefined) {
    const slug = await workspaceOfProject(config, scope.project);

    if (scope.workspace !== undefined && scope.workspace !== slug) {
      throw usageError(
        `Project ${scope.project.toUpperCase()} is in workspace ${slug}, not ${scope.workspace}`
      );
    }

    return slug;
  }

  const link = await findLink();

  const explicit =
    scope.workspace ?? link.workspace ?? process.env["FLINT_WORKSPACE"];

  if (explicit !== undefined) {
    return explicit;
  }

  const project = await projectOf(scope);

  if (project !== undefined) {
    return await workspaceOfProject(config, project);
  }

  const { workspaces } = await call(config, "GET /me");
  const [only] = workspaces;

  if (only === undefined || workspaces.length > 1) {
    throw usageError(
      "Pass -w <workspace>, run flint link or set FLINT_WORKSPACE"
    );
  }

  return only.slug;
};
