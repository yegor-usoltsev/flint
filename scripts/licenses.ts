import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { object, parse, record, string, unknown } from "valibot";

const PackageSchema = object({
  license: string(),
  name: string(),
  version: string(),
});

const MetafileSchema = object({ inputs: record(string(), unknown()) });

export const licenseNotice = (dir: string) => {
  const pkg = parse(
    PackageSchema,
    JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"))
  );

  const file = readdirSync(dir).find((f) => /^licen[cs]e/iu.test(f));

  const text =
    file === undefined
      ? ""
      : `\n${readFileSync(path.join(dir, file), "utf-8").trim()}\n`;

  return `\n## ${pkg.name} - ${pkg.version} (${pkg.license})\n${text}`;
};

if (import.meta.main) {
  const [metafile = "", output = ""] = Bun.argv.slice(2);
  const { inputs } = parse(MetafileSchema, await Bun.file(metafile).json());

  const dirs = new Set(
    Object.keys(inputs).flatMap(
      (input) => /^.*node_modules\/(?:@[^/]+\/)?[^/]+/u.exec(input) ?? []
    )
  );

  await Bun.write(
    output,
    `# Licenses\n\nThe app bundles dependencies which contain the following licenses:\n${[...dirs].toSorted().map(licenseNotice).join("")}`
  );
}
