import { expect, spyOn, test } from "bun:test";

import { request } from "~/lib/api";
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
