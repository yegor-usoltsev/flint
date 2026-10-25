import { expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { upsertEnv, writeEnv } from "./gitea-bootstrap";

test("upsertEnv replaces existing keys and keeps other lines", () => {
  const content = "# Local\nGITEA_CLIENT_ID=old\nOTHER=1\n";

  expect(upsertEnv(content, { GITEA_CLIENT_ID: "new" })).toBe(
    "# Local\nGITEA_CLIENT_ID=new\nOTHER=1\n"
  );
});

test("upsertEnv appends missing keys", () => {
  expect(upsertEnv("", { A: "1", B: "2" })).toBe("A=1\nB=2\n");
  expect(upsertEnv("A=1", { B: "2" })).toBe("A=1\nB=2\n");
});

const permissions = async (file: string) => {
  const stats = await lstat(file);

  return stats.mode.toString(8).slice(-3);
};

test("writeEnv leaves the file owner-only and keeps a symlink", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flint-env-"));
  const real = path.join(directory, "real.env");
  const link = path.join(directory, ".env.local");

  try {
    await writeFile(real, "A=1\n");
    await chmod(real, 0o664);
    await symlink(real, link);

    await writeEnv(link, { GITEA_CLIENT_SECRET: "secret" });

    const linkStats = await lstat(link);
    const content = await readFile(real, "utf-8");

    expect(linkStats.isSymbolicLink()).toBe(true);
    expect(await permissions(real)).toBe("600");
    expect(content).toBe("A=1\nGITEA_CLIENT_SECRET=secret\n");

    await writeEnv(path.join(directory, "new.env"), { A: "2" });

    expect(await permissions(path.join(directory, "new.env"))).toBe("600");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
