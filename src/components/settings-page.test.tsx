import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SettingsInput } from "~/components/settings-page";

const input = (emptyAllowed: boolean) =>
  renderToStaticMarkup(
    <SettingsInput
      disabled={false}
      emptyAllowed={emptyAllowed}
      id="field"
      maxLength={10}
      onSave={async () => {}}
      value=""
    />
  );

test("a field that may be empty is not marked required", () => {
  expect(input(false)).toContain("required");
  expect(input(true)).not.toContain("required");
});
