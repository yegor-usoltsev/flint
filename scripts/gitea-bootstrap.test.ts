import { expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
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

test("bootstrap persists reused OAuth credentials without an existing env file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flint-bootstrap-"));
  const scripts = path.join(directory, "scripts");

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/api/v1/admin/hooks") {
        return Response.json(
          request.method === "GET"
            ? []
            : {
                config: { url: "http://localhost:4700/api/webhooks/gitea" },
                id: 1,
              }
        );
      }

      if (
        url.pathname === "/api/v1/user/applications/oauth2" &&
        request.method === "GET"
      ) {
        return Response.json([
          {
            client_id: "retained-client",
            id: 7,
            name: "Flint",
            redirect_uris: ["http://localhost:4700/api/auth/callback"],
          },
        ]);
      }

      return new Response(null, { status: 500 });
    },
  });

  try {
    await mkdir(scripts);
    await Promise.all(
      ["gitea-bootstrap.ts", "gitea-client.ts"].map(async (name) => {
        await copyFile(
          path.join(import.meta.dir, name),
          path.join(scripts, name)
        );
      })
    );
    await symlink(
      path.join(import.meta.dir, "../node_modules"),
      path.join(directory, "node_modules")
    );

    const child = Bun.spawn(["bun", path.join(scripts, "gitea-bootstrap.ts")], {
      cwd: directory,
      env: {
        ...process.env,
        APP_URL: "http://localhost:4700",
        GITEA_CLIENT_ID: "retained-client",
        GITEA_CLIENT_SECRET: "retained-secret",
        GITEA_URL: server.url.href,
        GITEA_WEBHOOK_SECRET: "test-webhook-secret",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const status = await child.exited;
    expect(await new Response(child.stderr).text()).toBe("");
    expect(status).toBe(0);
    const file = path.join(directory, ".env.local");
    expect(await readFile(file, "utf-8")).toBe(
      "GITEA_CLIENT_ID=retained-client\nGITEA_CLIENT_SECRET=retained-secret\n"
    );
    expect(await permissions(file)).toBe("600");
  } finally {
    await server.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
});
