import { expect, test } from "bun:test";

import { Route } from "~/routes/$slug/project/$key";

type BeforeLoad = NonNullable<typeof Route.options.beforeLoad>;

const beforeLoad = (key: string) => {
  try {
    // SAFETY: beforeLoad reads only `params` and `search`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Tests have no router context to pass.
    Route.options.beforeLoad?.({
      params: { key, slug: "acme" },
      search: { issue: "ENG-3", status: ["todo"] },
    } as Parameters<BeforeLoad>[0]);
  } catch (error) {
    return error;
  }

  return null;
};

test("redirects a lowercase project key to the canonical one", () => {
  expect(beforeLoad("eng")).toMatchObject({
    options: {
      params: { key: "ENG", slug: "acme" },
      replace: true,
      search: { issue: "ENG-3", status: ["todo"] },
      to: "/$slug/project/$key",
    },
  });
});

test("keeps an uppercase project key", () => {
  expect(beforeLoad("ENG")).toBeNull();
});
