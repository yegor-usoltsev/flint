import { expect, test } from "bun:test";

import { Route as callbackRoute } from "~/routes/api/auth/callback";
import { Route as loginRoute } from "~/routes/api/auth/login";
import { Route as logoutRoute } from "~/routes/api/auth/logout";
import { Route as healthRoute } from "~/routes/api/health";

import { appRequest, callRoute } from "../../test/helpers";

test.each([
  [callbackRoute, "/api/auth/callback", "POST"],
  [loginRoute, "/api/auth/login", "POST"],
  [logoutRoute, "/api/auth/logout", "GET"],
  [healthRoute, "/api/health", "POST"],
] as const)("route %s at %s rejects %s", async (route, path, method) => {
  const response = await callRoute(route, appRequest(path, { method }));

  expect(response.status).toBe(405);
  expect(response.headers.get("content-type")).toStartWith("application/json");
  expect(await response.json()).toEqual({
    error: { code: "method_not_allowed", message: "Method not allowed" },
  });
});
