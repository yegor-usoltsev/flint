import { spyOn } from "bun:test";

import { db } from "~/server/db.server";
import { createSession } from "~/server/sessions.server";
import { signIn } from "~/server/users.server";

export const resetDatabase = async () => {
  const tables = await db<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'schema_migrations'
  `;

  await db.unsafe(
    `truncate ${tables.map(({ tablename }) => JSON.stringify(tablename)).join(", ")} cascade`
  );
};

const giteaIds = new Map<string, number>();

const giteaIdOf = (username: string) => {
  const key = username.toLowerCase();
  const id = giteaIds.get(key) ?? 1000 + giteaIds.size;

  giteaIds.set(key, id);

  return id;
};

const fakeGiteaUsers = async () =>
  await Promise.resolve(
    Response.json({ message: "not found" }, { status: 404 })
  );

export const stubGiteaUsers = () =>
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fakeGiteaUsers, { preconnect: fetch.preconnect })
  );

export const createUser = async (username: string) =>
  await signIn({
    avatarUrl: "",
    email: `${username}@example.test`,
    giteaId: String(giteaIdOf(username)),
    name: username,
    username,
  });

export const sessionCookieFor = async (userId: string) => {
  const cookie = await createSession(userId);

  return cookie.split(";")[0] ?? "";
};

type Handler = (context: {
  params: Record<string, string>;
  request: Request;
}) => Response | Promise<Response>;

interface ServerRoute {
  options: { server?: { handlers?: object } };
}

export const callRoute = async (
  route: ServerRoute,
  request: Request,
  params: Record<string, string> = {}
) => {
  const handlers = new Map<string, Handler>(
    Object.entries(route.options.server?.handlers ?? {})
  );

  const handler = handlers.get(request.method) ?? handlers.get("ANY");

  if (handler === undefined) {
    throw new Error(`No ${request.method} handler`);
  }

  return await handler({ params, request });
};

export const appRequest = (path: string, init: RequestInit = {}) =>
  new Request(new URL(path, "http://flint.test"), init);

export const callApi = async (
  route: ServerRoute,
  auth: string,
  method: string,
  path: string,
  { body, params }: { body?: object; params?: Record<string, string> } = {}
) => {
  const headers = new Headers(
    auth.startsWith("Bearer ")
      ? { authorization: auth }
      : { cookie: auth, "sec-fetch-site": "same-origin" }
  );

  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await callRoute(
    route,
    appRequest(path, {
      body: body === undefined ? null : JSON.stringify(body),
      headers,
      method,
    }),
    params
  );

  const json: unknown =
    response.status === 204 ? undefined : await response.json();

  return { body: json, status: response.status };
};
