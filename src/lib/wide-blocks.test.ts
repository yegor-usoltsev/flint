import { expect, test } from "bun:test";

import { wideExtra } from "~/lib/wide-blocks";

test("wide blocks grow evenly into the narrower side, up to the maximum width", () => {
  expect(wideExtra({ left: 600, max: 1280, right: 300, text: 833 })).toBe(447);
  expect(wideExtra({ left: 100, max: 1280, right: 300, text: 833 })).toBe(200);
  expect(wideExtra({ left: 40, max: 1280, right: -10, text: 833 })).toBe(0);
  expect(wideExtra({ left: 600, max: 800, right: 600, text: 833 })).toBe(0);
});
