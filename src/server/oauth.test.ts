import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";

import { Route as callbackRoute } from "~/routes/api/auth/callback";
import { Route as loginRoute } from "~/routes/api/auth/login";
import { Route as logoutRoute } from "~/routes/api/auth/logout";
import { Route as meRoute } from "~/routes/api/v1/me";
import { db } from "~/server/db.server";

import {
  appRequest,
  callRoute,
  createUser,
  resetDatabase,
  sessionCookieFor,
} from "../../test/helpers";

interface FakeUser {
  name: string;
  sub: string;
  username: string;
}

const tokenRequests: URLSearchParams[] = [];
let giteaUser: FakeUser = { name: "Alice", sub: "1", username: "alice" };

const answer = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);

  if (url.href === "http://gitea.test/login/oauth/access_token") {
    tokenRequests.push(
      init?.body instanceof URLSearchParams ? init.body : new URLSearchParams()
    );

    return Response.json({ access_token: `access-${giteaUser.sub}` });
  }

  if (url.href === "http://gitea.test/login/oauth/userinfo") {
    return Response.json({
      email: `${giteaUser.username}@example.test`,
      name: giteaUser.name,
      picture: "http://gitea.test/avatars/a",
      preferred_username: giteaUser.username,
      sub: giteaUser.sub,
    });
  }

  return new Response("not found", { status: 404 });
};

const fakeGitea = async (input: RequestInfo | URL, init?: RequestInit) =>
  await Promise.resolve(answer(input, init));

beforeEach(async () => {
  await resetDatabase();
  tokenRequests.length = 0;
  giteaUser = { name: "Alice", sub: "1", username: "alice" };
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fakeGitea, { preconnect: fetch.preconnect })
  );
});

afterEach(() => {
  mock.restore();
});

const cookiesOf = (response: Response) =>
  response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");

const login = async (state?: string, start = "/api/auth/login") => {
  const started = await callRoute(loginRoute, appRequest(start));
  const authorize = new URL(started.headers.get("location") ?? "");
  const [attempt = ""] = cookiesOf(started);

  const callback = appRequest(
    `/api/auth/callback?code=the-code&state=${state ?? authorize.searchParams.get("state")}`,
    { headers: { cookie: attempt } }
  );

  return { authorize, response: await callRoute(callbackRoute, callback) };
};

const getMe = async (cookie: string) =>
  await callRoute(meRoute, appRequest("/api/v1/me", { headers: { cookie } }));

test("login redirects to Gitea with PKCE and a one-time state", async () => {
  const response = await callRoute(loginRoute, appRequest("/api/auth/login"));
  const location = new URL(response.headers.get("location") ?? "");

  expect(response.status).toBe(302);
  expect(location.origin + location.pathname).toBe(
    "http://gitea-public.test/login/oauth/authorize"
  );
  expect(location.searchParams.get("client_id")).toBe("test-client");
  expect(location.searchParams.get("redirect_uri")).toBe(
    "http://flint.test/api/auth/callback"
  );
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(response.headers.getSetCookie()[0]).toContain("HttpOnly");
  expect(response.headers.getSetCookie()[0]).toContain("Path=/api/auth");
});

test("callback returns to a same-origin returnTo and ignores others", async () => {
  const target = "/acme/issue/ENG-1?view=board#top";

  const back = await login(
    undefined,
    `/api/auth/login?returnTo=${encodeURIComponent(target)}`
  );

  expect(back.response.headers.get("location")).toBe(target);

  for (const returnTo of [
    "https://evil.test/x",
    "//evil.test/x",
    "/\\evil.test",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- Each login needs a fresh attempt cookie.
    const { response } = await login(
      undefined,
      `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    );

    expect(response.headers.get("location")).toBe("/");
  }
});

test("callback exchanges the code with the verifier and opens a session", async () => {
  const { authorize, response } = await login();
  const [, session = ""] = cookiesOf(response);
  const [exchange] = tokenRequests;
  const verifier = exchange?.get("code_verifier") ?? "";

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/");
  expect(exchange?.get("code")).toBe("the-code");
  expect(exchange?.get("client_secret")).toBe("test-secret");
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
    authorize.searchParams.get("code_challenge") ?? ""
  );
  expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");

  const me = await getMe(session);

  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    avatarUrl: "http://gitea-public.test/avatars/a",
    giteaUrl: "http://gitea-public.test",
    trashDays: 30,
    isInstanceAdmin: true,
    username: "alice",
    workspaces: [],
  });
});

test("callback rejects a state that does not match the attempt", async () => {
  const { response } = await login("forged");

  expect(response.headers.get("location")).toBe("/?error=login");
  expect(cookiesOf(response)).toHaveLength(1);
  expect(tokenRequests).toHaveLength(0);
});

test("callback rejects a non-ASCII state of the same length", async () => {
  const { response } = await login(encodeURIComponent("é".repeat(43)));

  expect(response.headers.get("location")).toBe("/?error=login");
  expect(tokenRequests).toHaveLength(0);
});

test("callback without the attempt cookie fails", async () => {
  const response = await callRoute(
    callbackRoute,
    appRequest("/api/auth/callback?code=the-code&state=anything")
  );

  expect(response.headers.get("location")).toBe("/?error=login");
});

test("only the first user becomes instance admin, even concurrently", async () => {
  await Promise.all(
    ["a", "b", "c", "d"].map(async (name) => await createUser(name))
  );

  const admins = await db<
    unknown[]
  >`select 1 from users where is_instance_admin`;

  expect(admins).toHaveLength(1);
});

test("login applies pending invites and refreshes the profile", async () => {
  const ownerId = await createUser("owner");
  const workspaceId = Bun.randomUUIDv7();
  await db`insert into workspaces (id, slug, name, color) values (${workspaceId}, 'acme', 'Acme', 'blue')`;
  await db`
    insert into invites (id, workspace_id, gitea_username, role, created_by)
    values (${Bun.randomUUIDv7()}, ${workspaceId}, 'Alice', 'member', ${ownerId})
  `;

  await login();
  giteaUser = { name: "Alice Renamed", sub: "1", username: "alice2" };
  const { response } = await login();
  const [, session = ""] = cookiesOf(response);
  const me = await getMe(session);

  expect(await me.json()).toMatchObject({
    isInstanceAdmin: false,
    displayName: "Alice Renamed",
    username: "alice2",
    workspaces: [{ name: "Acme", role: "member", slug: "acme" }],
  });
  expect(await db<unknown[]>`select 1 from invites`).toHaveLength(0);
  expect(
    await db<unknown[]>`select 1 from users where gitea_id = '1'`
  ).toHaveLength(1);
});

test("an invite applies only to the username it was made for", async () => {
  const ownerId = await createUser("owner");
  const workspaceId = Bun.randomUUIDv7();
  await db`insert into workspaces (id, slug, name, color) values (${workspaceId}, 'acme', 'Acme', 'blue')`;
  await db`
    insert into invites (id, workspace_id, gitea_username, role, created_by)
    values (${Bun.randomUUIDv7()}, ${workspaceId}, 'alice2', 'member', ${ownerId})
  `;

  giteaUser = { name: "Alice", sub: "1", username: "alice" };
  const { response } = await login();
  const [, session = ""] = cookiesOf(response);

  const me = await getMe(session);

  expect(await me.json()).toMatchObject({
    username: "alice",
    workspaces: [],
  });
  expect(await db<unknown[]>`select 1 from invites`).toHaveLength(1);
});

test("logout ends the session and rejects cross-site requests", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));

  const crossSite = await callRoute(
    logoutRoute,
    appRequest("/api/auth/logout", {
      headers: { cookie, "sec-fetch-site": "cross-site" },
      method: "POST",
    })
  );

  expect(crossSite.status).toBe(403);
  expect(await getMe(cookie)).toHaveProperty("status", 200);

  const response = await callRoute(
    logoutRoute,
    appRequest("/api/auth/logout", {
      headers: { cookie, "sec-fetch-site": "same-origin" },
      method: "POST",
    })
  );

  expect(response.status).toBe(204);
  expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");
  expect(await getMe(cookie)).toHaveProperty("status", 401);
});
