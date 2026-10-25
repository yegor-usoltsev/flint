import { beforeEach, expect, test } from "bun:test";

// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { Route as unknownRoute } from "~/routes/api/v1/$";
import { Route as meRoute } from "~/routes/api/v1/me";
import { Route as tokenRoute } from "~/routes/api/v1/me/tokens/$tokenId";
import { Route as tokensRoute } from "~/routes/api/v1/me/tokens/index";
import { apiHandler } from "~/server/api.server";

import {
  appRequest,
  callRoute,
  createUser,
  resetDatabase,
  sessionCookieFor,
} from "../../test/helpers";

beforeEach(resetDatabase);

const postToken = async (headers: Record<string, string>, body: string) =>
  await callRoute(
    tokensRoute,
    appRequest("/api/v1/me/tokens", {
      body,
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    })
  );

const getMe = async (headers: Record<string, string>) =>
  await callRoute(meRoute, appRequest("/api/v1/me", { headers }));

const sameOrigin = { "sec-fetch-site": "same-origin" };

const CreatedSchema = v.looseObject({
  id: v.string(),
  prefix: v.string(),
  token: v.string(),
});

const createToken = async (cookie: string, name: string) => {
  const response = await postToken(
    { cookie, ...sameOrigin },
    JSON.stringify({ name })
  );

  expect(response.status).toBe(201);

  return v.parse(CreatedSchema, await response.json());
};

const revokeToken = async (cookie: string, id: string) =>
  await callRoute(
    tokenRoute,
    appRequest(`/api/v1/me/tokens/${id}`, {
      headers: { cookie, ...sameOrigin },
      method: "DELETE",
    }),
    { tokenId: id }
  );

test("requests without credentials get the error envelope", async () => {
  const response = await getMe({});

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: "unauthorized", message: "Sign in required" },
  });
});

test("an API token is shown once and authenticates as its user", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));

  const { token, ...listed } = await createToken(cookie, "laptop");

  expect(token).toStartWith("flint_");
  expect(listed.prefix).toBe(token.slice(0, 14));

  const list = await callRoute(
    tokensRoute,
    appRequest("/api/v1/me/tokens", { headers: { cookie } })
  );

  expect(await list.json()).toEqual([listed]);

  const me = await getMe({ authorization: `Bearer ${token}` });

  expect(await me.json()).toMatchObject({ username: "alice" });

  const viaToken = await postToken(
    { authorization: `Bearer ${token}` },
    JSON.stringify({ name: "from cli" })
  );

  expect(viaToken.status).toBe(201);
});

test("a revoked or unknown token is rejected", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));

  const { id, token } = await createToken(cookie, "ci");
  const revoked = await revokeToken(cookie, id);

  expect(revoked.status).toBe(204);
  expect(await getMe({ authorization: `Bearer ${token}` })).toHaveProperty(
    "status",
    401
  );
  expect(await getMe({ authorization: "Bearer flint_nope" })).toHaveProperty(
    "status",
    401
  );
  expect(await getMe({ authorization: "Basic abc", cookie })).toHaveProperty(
    "status",
    401
  );
});

test("users cannot see or revoke each other's tokens", async () => {
  const alice = await sessionCookieFor(await createUser("alice"));
  const bob = await sessionCookieFor(await createUser("bob"));

  const { id } = await createToken(alice, "a");

  const list = await callRoute(
    tokensRoute,
    appRequest("/api/v1/me/tokens", { headers: { cookie: bob } })
  );

  const revoke = await revokeToken(bob, id);

  expect(await list.json()).toEqual([]);
  expect(revoke.status).toBe(404);
  expect(await revoke.json()).toMatchObject({ error: { code: "not_found" } });
});

test("cookie writes need a same-origin request", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));
  const body = JSON.stringify({ name: "x" });

  const rejected: Record<string, string>[] = [
    { cookie, "sec-fetch-site": "cross-site" },
    { cookie, "sec-fetch-site": "same-site" },
    { cookie, origin: "http://evil.test" },
    { cookie },
  ];

  for (const headers of rejected) {
    // oxlint-disable-next-line no-await-in-loop -- Each case is checked in turn.
    const response = await postToken(headers, body);

    expect(response.status).toBe(403);
    // oxlint-disable-next-line no-await-in-loop -- Each case is checked in turn.
    expect(await response.json()).toMatchObject({
      error: { code: "forbidden" },
    });
  }

  expect(
    await postToken({ cookie, origin: "http://flint.test" }, body)
  ).toHaveProperty("status", 201);
});

test("invalid input maps to invalid_request", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));
  const headers = { cookie, ...sameOrigin };
  const notJson = await postToken(headers, "{");
  const blankName = await postToken(headers, JSON.stringify({ name: " " }));

  expect(notJson.status).toBe(400);
  expect(await notJson.json()).toMatchObject({
    error: { code: "invalid_request" },
  });
  expect(blankName.status).toBe(400);
  expect(await blankName.json()).toMatchObject({
    error: { code: "invalid_request" },
  });
});

test("unexpected errors and unknown endpoints keep the envelope", async () => {
  const cookie = await sessionCookieFor(await createUser("alice"));

  const failing = apiHandler(async () => {
    await Promise.resolve();
    throw new Error("boom");
  });

  const crash = await failing({
    params: {},
    request: appRequest("/api/v1/x", { headers: { cookie } }),
  });

  const unknown = await callRoute(unknownRoute, appRequest("/api/v1/nope"));

  const wrongMethod = await callRoute(
    meRoute,
    appRequest("/api/v1/me", { method: "PUT" })
  );

  expect(crash.status).toBe(500);
  expect(await crash.json()).toEqual({
    error: { code: "internal", message: "Internal server error" },
  });
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toMatchObject({ error: { code: "not_found" } });
  expect(wrongMethod.status).toBe(405);
  expect(await wrongMethod.json()).toMatchObject({
    error: { code: "method_not_allowed" },
  });
});
