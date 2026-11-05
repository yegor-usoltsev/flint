import { expect, test } from "bun:test";

const loadEnv = (instanceAdmins: string) =>
  Bun.spawnSync(["bun", "-e", 'await import("./src/server/env.server.ts")'], {
    env: { ...process.env, INSTANCE_ADMINS: instanceAdmins },
  });

test("INSTANCE_ADMINS takes Gitea usernames and refuses anything else, a lone @ included", () => {
  expect(loadEnv(" alice, @Bob ,").success).toBeTrue();
  expect(loadEnv("").success).toBeTrue();

  for (const value of [
    "@",
    "alice, @",
    "..",
    "-x",
    ",,,",
    "alice-",
    "alice..bob",
    "\u212Aelvin",
  ]) {
    expect(loadEnv(value).success).toBeFalse();
  }
});
