import { expect, spyOn, test } from "bun:test";

import { api, isNotFound, request } from "~/lib/api";
import type { Workspace } from "~/lib/api-types";
import { endpointPath } from "~/lib/endpoints";
import type { RequestOptions } from "~/lib/endpoints";

import { call } from "../../cli/client.ts";

test("typed queries reach the URL", () => {
  const search: RequestOptions<"GET /workspaces/:slug/search"> = {
    params: { slug: "acme" },
    query: { mode: "fts", q: "login" },
  };

  const issues: RequestOptions<"GET /projects/:key/issues"> = {
    params: { key: "ENG" },
    query: { label: ["bug", "ui"], status: ["todo"] },
  };

  expect(
    endpointPath("GET /workspaces/:slug/search", search.params, search.query)
  ).toEqual({
    method: "GET",
    path: "/workspaces/acme/search?mode=fts&q=login",
  });
  expect(
    endpointPath("GET /projects/:key/issues", issues.params, issues.query).path
  ).toBe("/projects/ENG/issues?label=bug&label=ui&status=todo");
});

test("dot segments never reach a request path", () => {
  for (const username of [".", ".."]) {
    expect(() =>
      endpointPath("DELETE /workspaces/:slug/members/:username", {
        slug: "acme",
        username,
      })
    ).toThrow("cannot be part of a request path");
  }

  expect(() =>
    endpointPath("GET /workspaces/:slug/wiki/*", {
      _splat: "docs/../../../me/tokens",
      slug: "acme",
    })
  ).toThrow("cannot be part of a request path");
  expect(
    endpointPath("DELETE /workspaces/:slug/members/:username", {
      slug: "acme",
      username: "a..b",
    }).path
  ).toBe("/workspaces/acme/members/a..b");
});

test("the web client sends no path that leaves its endpoint", async () => {
  const spy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));

  for (const path of [
    "/issues/../workspaces/acme",
    "/projects/%2E%2E/me",
    String.raw`/issues/..\workspaces\acme`,
    "/wiki/.\t./me",
    "/issues/./x",
    "/workspaces/acme/wiki/.. ",
    "/workspaces/acme/wiki/..\u0000",
  ]) {
    expect(
      // oxlint-disable-next-line no-await-in-loop -- Each path is checked on its own.
      await api(path, { method: "DELETE" })
        .then(() => false)
        .catch(isNotFound)
    ).toBe(true);
  }

  await api("/workspaces/acme/search?q=../x");

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]?.[0]).toBe("/api/v1/workspaces/acme/search?q=../x");
  spy.mockRestore();
});

const sentBodies = async (send: (form: FormData) => Promise<Workspace>) => {
  const spy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ slug: "acme" })
  );

  const form = new FormData();

  form.set("file", new File(["x"], "logo.png", { type: "image/png" }));
  await send(form);

  const [input, init] = spy.mock.calls[0] ?? [];

  spy.mockRestore();

  return {
    body: init?.body,
    contentType: new Headers(init?.headers).get("content-type"),
    form,
    url: input instanceof Request ? input.url : String(input),
  };
};

test("web and CLI clients send FormData bodies as multipart", async () => {
  const web = await sentBodies(
    async (body) =>
      await request("PUT /workspaces/:slug/logo", {
        body,
        params: { slug: "acme" },
      })
  );

  const cli = await sentBodies(
    async (body) =>
      await call(
        { token: "t", url: "http://flint.test" },
        "PUT /workspaces/:slug/logo",
        { body, params: { slug: "acme" } }
      )
  );

  expect(web).toEqual({
    body: web.form,
    contentType: null,
    form: web.form,
    url: "/api/v1/workspaces/acme/logo",
  });
  expect(cli).toMatchObject({
    body: cli.form,
    contentType: null,
    url: "http://flint.test/api/v1/workspaces/acme/logo",
  });
});
