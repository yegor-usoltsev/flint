import { expect, test } from "bun:test";

import { externalTracker } from "./gitea-external-tracker";

test("the tracker pattern matches only bracketed issue keys, in any case", () => {
  const { external_tracker_regexp_pattern: pattern } = externalTracker(
    "https://flint.test/app"
  );

  const regexp = new RegExp(pattern, "u");

  expect(regexp.exec("Fixes [ENG-12]")?.[1]).toBe("ENG-12");
  expect(regexp.exec("[eng-12] Fix")?.[1]).toBe("eng-12");
  expect(regexp.exec("ENG-12, UTF-8 and SHA-256")).toBeNull();
  expect(regexp.exec("[TOOLONG-1] and [E-1]")).toBeNull();
});
