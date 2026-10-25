import { expect, test } from "bun:test";

import { createLimit } from "~/lib/limit";

test("runs at most the given number of tasks at once, in order", async () => {
  const limit = createLimit(2);
  const started: number[] = [];
  let running = 0;
  let peak = 0;

  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(
      async (item) =>
        await limit(async () => {
          started.push(item);
          running += 1;
          peak = Math.max(peak, running);
          await Bun.sleep(item === 1 ? 5 : 1);
          running -= 1;

          return item * 10;
        })
    )
  );

  expect(results).toEqual([10, 20, 30, 40, 50]);
  expect(peak).toBe(2);
  expect(started).toEqual([1, 2, 3, 4, 5]);
});

test("frees the slot when a task fails", async () => {
  const limit = createLimit(1);

  const failed = limit(async () => {
    await Bun.sleep(1);
    throw new Error("boom");
  });

  const next = limit(async () => await Promise.resolve("ok"));

  expect(failed).rejects.toThrow("boom");
  expect(await next).toBe("ok");
});
