import { expect, test } from "bun:test";

import { ApiError } from "~/lib/api";
import { afterSave, rejection, textToSave } from "~/lib/use-autosave-text";

test("only a changed, non-empty draft is saved", () => {
  expect(textToSave(null, "Acme")).toBeNull();
  expect(textToSave("  ", "Acme")).toBeNull();
  expect(textToSave(" Acme ", "Acme")).toBeNull();
  expect(textToSave(" Acme Co ", "Acme")).toBe("Acme Co");
});

test("a successful save clears the draft unless it changed meanwhile", () => {
  expect(afterSave("Acme Co", "Acme Co")).toBeNull();
  expect(afterSave("Acme Corp", "Acme Co")).toBe("Acme Corp");
  expect(afterSave(null, "Acme Co")).toBeNull();
});

test("a rejected value shows the server's reason instead of Retry", () => {
  const invalid = { code: "invalid_request", message: "This slug is reserved" };

  expect(rejection(new ApiError(400, invalid))).toBe("This slug is reserved");
  expect(
    rejection(new ApiError(409, { code: "conflict", message: "Taken" }))
  ).toBe("Taken");
  expect(
    rejection(new ApiError(503, { code: "internal", message: "Down" }))
  ).toBeNull();
});
